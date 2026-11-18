import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { once } from 'node:events'
import { createCircle } from './circle.mjs'
import { createApp } from './server.mjs'
import { findCircleStream } from './public/playback.js'

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

test('only Play requests Circle, then relays the resolved video as a byte range', async t => {
  let origin
  const upstreamRequests = []
  const upstream = createServer((request, response) => {
    const url = new URL(request.url, origin)
    upstreamRequests.push(url.pathname)
    const json = body => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    if (url.pathname === '/api/posts') {
      assert.equal(url.searchParams.get('searchTerm'), 'North Star')
      return json({ posts: [
        { id: 31, name: 'North Star', year: '2000', type: 'singleVideo' },
        { id: 32, title: 'North Star (2025) [1080p]', type: 'singleVideo' }
      ] })
    }
    if (url.pathname === '/api/posts/32') return json({ content: origin + '/movie.mp4' })
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
  for (const path of ['/', '/search?q=North', '/title/movie/tt1234567', '/watch/movie/tt1234567']) {
    assert.equal((await get(path)).status, 200)
  }
  assert.equal((await get('/api/catalog')).status, 404)
  assert.equal((await get('/api/ready')).status, 404)
  assert.deepEqual(upstreamRequests, [])

  const playback = await get('/api/play?kind=movie&title=North+Star&year=2025')
  assert.equal(playback.status, 200)
  const { src } = await playback.json()
  assert.deepEqual(upstreamRequests, ['/api/posts', '/api/posts/32'])
  const video = await fetch(app + src, { headers: { Range: 'bytes=2-5' } })
  assert.equal(video.status, 206)
  assert.equal(video.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(video.headers.get('content-type'), 'video/mp4')
  assert.equal(await video.text(), '2345')
  assert.equal((await fetch(app + src, { headers: { Range: 'bytes=0-2,4-5' } })).status, 416)
})

test('Circle series playback selects the requested episode and rejects unrelated media URLs', async () => {
  const requests = []
  const source = 'http://15.1.1.50/episode-2.mp4'
  const read = async path => {
    requests.push(path)
    return path.includes('?')
      ? { posts: [{ id: 17, name: 'Harbour', type: 'series' }] }
      : { content: [{ seasonName: 'Season 1', episodes: [
        { title: 'S01E02', link: source },
        { title: 'S01E01', link: 'http://169.254.169.254/internal.mp4' }
      ] }] }
  }
  assert.equal((await findCircleStream({ title: 'Harbour', kind: 'series', season: 1, episode: 2 }, read)).href, source)
  assert.equal(await findCircleStream({ title: 'Harbour', kind: 'series', season: 1, episode: 1 }, read), null)
  assert.equal(requests.some(path => path.startsWith('/api/posts?searchTerm=Harbour')), true)
})

test('Circle fails clearly when neither endpoint responds', async () => {
  const tried = []
  const circle = createCircle({
    origins: ['http://first.example', 'http://second.example'],
    doFetch: async url => { tried.push(url.hostname); throw new TypeError('Connection failed') }
  })
  await assert.rejects(circle.resolve({ title: 'Harbour', kind: 'movie' }), { status: 502 })
  assert.deepEqual(tried, ['first.example', 'second.example'])
})
