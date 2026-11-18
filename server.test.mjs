import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import { test } from 'node:test'
import { once } from 'node:events'
import { createCircle } from './circle.mjs'
import { createApp } from './server.mjs'
import { pagesOrigin, parseBridge } from './public/connection.js'

async function listen(server, context) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => {
    const closed = new Promise(resolve => server.close(resolve))
    server.closeAllConnections()
    return closed
  })
  return 'http://127.0.0.1:' + server.address().port
}

test('catalogue, artwork, details and byte-range playback use the Circle adapter', async t => {
  let origin
  let catalogueQuery
  let titleRequests = 0
  const movie = { id: 32, name: 'North Star', type: 'singleVideo', imageSm: 'north star.jpg', year: '2025' }
  const upstream = createServer((request, response) => {
    const url = new URL(request.url, origin)
    if (url.pathname === '/api/posts') {
      catalogueQuery = url.searchParams
      return response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ posts: [movie, movie, { id: 19 }], totalPages: 2 }))
    }
    if (url.pathname === '/api/posts/32') {
      titleRequests++
      return response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ...movie, content: origin + '/movie.mp4', metaData: 'A quiet voyage.' }))
    }
    if (url.pathname === '/api/posts/33') {
      return response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({
          id: 33, title: 'Harbour', type: 'series',
          content: [{ seasonName: 'Season 1', episodes: [
            { title: 'Episode One', link: origin + '/movie.mp4' },
            { title: 'Unrelated URL', link: 'http://169.254.169.254/internal.mp4' }
          ] }]
        }))
    }
    if (url.pathname === '/uploads/north%20star.jpg') {
      return response.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('poster')
    }
    if (request.headers.range === 'bytes=2-5' && url.pathname === '/movie.mp4') {
      return response.writeHead(206, {
        'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 2-5/10',
        'Accept-Ranges': 'bytes', 'Content-Length': '4'
      }).end('2345')
    }
    response.writeHead(404).end()
  })
  origin = await listen(upstream, t)
  const app = await listen(createApp(createCircle({ origins: [origin] })), t)
  const get = path => fetch(app + path)

  const catalogue = await (await get('/api/catalog?q=North&category=6')).json()
  assert.equal(catalogueQuery.get('searchTerm'), 'North')
  assert.equal(catalogueQuery.get('categoryExact'), '6')
  assert.equal(catalogue.items.length, 1)
  assert.equal(catalogue.items[0].artwork, 'north%20star.jpg')
  assert.equal(catalogue.hasNext, true)
  assert.equal((await get('/art/north%20star.jpg')).status, 200)
  assert.equal((await get('/art/injected.svg')).status, 404)

  const title = await (await get('/api/titles/32')).json()
  assert.equal(title.playable, true)
  assert.equal(title.description, 'A quiet voyage.')
  assert.equal('content' in title, false)
  const video = await fetch(app + '/video/32/movie', { headers: { Range: 'bytes=2-5' } })
  assert.equal(video.status, 206)
  assert.equal(video.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(video.headers.get('content-type'), 'video/mp4')
  assert.equal(await video.text(), '2345')
  assert.equal(titleRequests, 1)
  assert.equal((await fetch(app + '/video/32/movie', { headers: { Range: 'bytes=0-2,4-5' } })).status, 416)

  const series = await (await get('/api/titles/33')).json()
  assert.deepEqual(series.seasons[0].episodes, [{ key: '0-0', title: 'Episode One' }])
  assert.equal((await get('/video/33/0-1')).status, 404)
  assert.equal((await get('/search?q=North')).status, 200)
  assert.equal((await get('/title/32')).status, 200)
  assert.equal((await get('/watch/32')).status, 200)
})

test('catalogue falls back to the second Circle endpoint and reports outage when both fail', async () => {
  const tried = []
  const options = {
    origins: ['http://first.example', 'http://second.example'],
    doFetch: async url => {
      tried.push(url.hostname)
      if (url.hostname === 'first.example') throw new TypeError('DNS failure')
      return Response.json({ posts: [] })
    }
  }
  const circle = createCircle(options)
  assert.deepEqual(await circle.catalog({ page: 1 }), { items: [], hasNext: false })
  await circle.catalog({ page: 2 })
  assert.deepEqual(tried, ['first.example', 'second.example', 'second.example'])
  const offline = createCircle({ ...options, doFetch: async () => { throw new TypeError('Connection failed') } })
  await assert.rejects(offline.catalog({ page: 1 }), { status: 502 })
})

test('the hosted page can reach the local helper and other sites cannot', async t => {
  const app = await listen(createApp(), t)
  const ready = app + '/api/ready'
  const approved = await fetch(ready, { headers: { Origin: pagesOrigin } })
  assert.equal(approved.headers.get('access-control-allow-origin'), pagesOrigin)
  assert.deepEqual(await approved.json(), { app: 'Screen Room' })
  const preflight = await fetch(ready, { method: 'OPTIONS', headers: { Origin: pagesOrigin } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Range')
  assert.equal((await fetch(ready, { headers: { Origin: 'https://other.example' } })).status, 403)
  for (const headers of [{ Host: 'other.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      get(ready, { headers }, response => {
        response.resume()
        resolve(response.statusCode)
      }).on('error', reject)
    })
    assert.equal(status, 403)
  }
  assert.equal(parseBridge('192.168.1.14').origin, 'http://192.168.1.14:4174')
  assert.equal(parseBridge('http://15.1.1.50:5000'), null)
})
