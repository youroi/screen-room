import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createCircle } from './circle.mjs'
import { createApp } from './server.mjs'
import { orderAudioTracks, playDecodedAudio, viaSource } from './public/browser-audio.js'
import { browserCircleStream, findCircleStream } from './public/playback.js'

test('Via reads only bounded byte ranges of the current Circle MKV', async () => {
  const source = 'http://ftp16.circleftp.net/Pilot%20S01E01.mkv'
  const location = { href: 'http://new.circleftp.net:5000/api/posts?searchTerm=screen-room-browser' }
  const window = {}
  const document = { querySelector: selector => selector === '.player video' ? { currentSrc: source } : {} }
  const calls = []
  runInNewContext(readFileSync(new URL('./public/via-player.user.js', import.meta.url), 'utf8'), {
    window, document, location, URL, ArrayBuffer, setTimeout, clearTimeout,
    GM_xmlhttpRequest(request) {
      calls.push(request)
      request.onload({ status: 206, finalUrl: source, response: new ArrayBuffer(16), responseHeaders: '' })
    }
  })
  const { signal } = new AbortController()
  await assert.rejects(window.screenRoomReadMedia(source + '?different', 0, 16, signal), /approved Circle MKV/)
  await assert.rejects(window.screenRoomReadMedia(source, 0, 1048576, signal), /Invalid media range/)
  assert.equal((await window.screenRoomReadMedia(source, 1, 17, signal)).bytes.byteLength, 16)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.Range, 'bytes=1-16')
})

test('Via audio falls back to a one-byte size probe for short files', async () => {
  const signal = new AbortController().signal
  let size = 800
  const calls = []
  const data = viaSource('http://ftp16.circleftp.net/Pilot.mkv', async (source, start, end) => {
    assert.equal(source, 'http://ftp16.circleftp.net/Pilot.mkv')
    calls.push([start, end])
    return {
      headers: 'Content-Range: bytes ' + start + '-' + (end - 1) + '/' + size,
      bytes: new Uint8Array(end - start).fill(7).buffer
    }
  }, signal)

  assert.equal(await data.getSize(), 800)
  assert.deepEqual(await data.read(20, 23), Uint8Array.of(7, 7, 7))
  assert.deepEqual(calls, [[0, 128 * 1024], [0, 1], [20, 23]])
  size = 803
  await assert.rejects(data.read(23, 25), /different byte range/)
})

test('Via audio reads large blocks in bounded parallel batches and preserves byte order', async () => {
  const chunk = 512 * 1024
  const size = chunk * 5 + 10
  let inflight = 0
  let peak = 0
  let calls = 0
  const source = viaSource('http://ftp16.circleftp.net/Pilot.mkv', async (_, start, end) => {
    calls++
    assert.ok(end - start <= chunk)
    peak = Math.max(peak, ++inflight)
    await new Promise(resolve => setImmediate(resolve))
    inflight--
    return {
      headers: 'Content-Range: bytes ' + start + '-' + (end - 1) + '/' + size,
      bytes: new Uint8Array(end - start).fill(start / chunk).buffer
    }
  }, new AbortController().signal)
  assert.equal(await source.getSize(), size)
  assert.deepEqual(await source.read(0, 2), Uint8Array.of(0, 0))
  assert.equal(calls, 1)
  const data = await source.read(chunk, size)
  assert.equal(peak, 4)
  assert.deepEqual([0, 1, 2, 3, 4].map(index => data[index * chunk]), [1, 2, 3, 4, 5])
})

test('audio preference keeps Hindi ahead of the original, default and commentary', () => {
  const tracks = [
    { language: 'hin', disposition: { commentary: true }, name: 'Commentary' },
    { language: 'eng', disposition: { default: true }, primary: true },
    { language: 'kor', disposition: { original: true } },
    { language: 'und', disposition: {}, name: 'Hindi 5.1' }
  ]
  assert.deepEqual(orderAudioTracks(tracks), [tracks[3], tracks[2], tracks[1], tracks[0]])
  assert.deepEqual(orderAudioTracks(tracks.slice(0, 3)), [tracks[2], tracks[1], tracks[0]])
})

test('decoded audio pauses before an underrun and reuses pending PCM to resume', { timeout: 2000 }, async t => {
  const controller = new AbortController()
  t.after(() => controller.abort())
  const video = Object.assign(new EventTarget(), {
    paused: true, currentTime: 0, playbackRate: 1, readyState: 4, duration: 2
  })
  const context = {
    currentTime: 0,
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: {}, connect() {}, start() {}, stop() {} })
  }
  const download = Promise.withResolvers()
  const interrupted = Promise.withResolvers()
  let readers = 0
  const sink = {
    async *buffers() {
      readers++
      for (let frame = 0; frame < 20; frame++) {
        if (frame === 6) await download.promise
        yield { timestamp: frame / 10, buffer: { duration: 0.1 } }
      }
    }
  }
  const audio = playDecodedAudio(video, sink, context, controller.signal, {
    volume: 1,
    started() {},
    failed: interrupted.reject,
    starved() {
      video.paused = true
      video.dispatchEvent(new Event('pause'))
      interrupted.resolve()
    }
  })

  assert.ok(await audio.ready(0))
  video.paused = false
  video.dispatchEvent(new Event('playing'))
  video.currentTime = 0.54
  await interrupted.promise
  assert.ok(video.paused)

  download.resolve()
  assert.ok(await audio.ready(video.currentTime))
  assert.equal(readers, 1)
})

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

test('the Circle web player uses HTTP only inside an approved Circle tab', async t => {
  const requests = []
  const source = 'http://15.1.1.50:5000/north.mp4'
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(new URL(url).origin)
    return String(url).includes('?')
      ? Response.json({ posts: [{ id: 8, name: 'North Star', type: 'singleVideo' }] })
      : Response.json({ content: source })
  })
  const item = { title: 'North Star', kind: 'movie' }
  const { signal } = new AbortController()
  assert.equal(await browserCircleStream(item, signal, 'http://15.1.1.50:5000'), source)
  assert.deepEqual(requests, ['http://15.1.1.50:5000', 'http://15.1.1.50:5000'])
  requests.length = 0
  await assert.rejects(browserCircleStream(item, signal, 'http://unrelated.example'), /Open the Circle tab/)
  assert.deepEqual(requests, [])
})

test('Circle retries the verified original title and skips other IMDb IDs and release years', async t => {
  const urls = []
  const release = 'http://15.1.1.50/parasite.mp4'
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input)
    urls.push(url)
    if (url.hostname === 'www.wikidata.org') {
      if (url.searchParams.get('action') === 'query') {
        assert.equal(url.searchParams.get('srsearch'), 'haswbstatement:P345=tt6751668')
        return Response.json({ query: { search: [{ title: 'Q61448040' }, { title: 'Q123' }] } })
      }
      const claim = value => [{ mainsnak: { datavalue: { value } } }]
      return Response.json({ entities: {
        Q61448040: { claims: { P345: claim('tt6751668'), P1476: claim({ text: '기생충' }) } },
        Q123: { claims: { P345: claim('tt1234567'), P1476: claim({ text: 'Wrong title' }) } }
      } })
    }
    if (url.pathname === '/api/posts') return Response.json({ posts: url.searchParams.get('searchTerm') === '기생충' ? [
      { id: 1, title: '기생충.1982.1080p', type: 'singleVideo' },
      { id: 2, title: '기생충.2019.1080p', type: 'singleVideo', imdb_id: 'tt1234567' },
      { id: 3, title: '기생충.2019.1080p.WEB-DL', type: 'singleVideo' }
    ] : [] })
    assert.equal(url.pathname, '/api/posts/3')
    return Response.json({ content: release })
  })
  const item = { id: 'tt6751668', title: 'Parasite', kind: 'movie', year: '2019' }
  const { signal } = new AbortController()
  assert.equal(await browserCircleStream(item, signal, 'http://new.circleftp.net:5000'), release)
  assert.deepEqual(urls.map(url => url.searchParams.get('searchTerm')).filter(Boolean), ['Parasite', '기생충'])
  urls.length = 0
  await assert.rejects(browserCircleStream(item, signal, 'http://new.circleftp.net:5000', new Set([release])),
    /No other matching Circle stream/)
  assert.deepEqual(urls.map(url => url.hostname), ['new.circleftp.net', 'new.circleftp.net', 'new.circleftp.net'])
})

test('episodes match explicit season and episode codes across unnamed groups', async () => {
  const base = 'http://15.1.1.50/'
  const read = async path => path.includes('?')
    ? { posts: [{ id: '8', title: 'Harbour.2021.1080p', type: 'series' }] }
    : { content: [{ episodes: [{ title: 'Episode 3', link: base + 'Harbour.S01E03.mkv' }] }, {
      episodes: [{ title: '2x03', link: base + 'Harbour.2x03.mp4' }, { title: 'S02E03', link: base + 'Harbour.S02E03.mkv' }]
    }] }
  const episode = { title: 'Harbour', year: '2021', kind: 'series', season: 2, episode: 3 }
  const first = await findCircleStream(episode, read)
  assert.equal(first.href, base + 'Harbour.2x03.mp4')
  const other = await findCircleStream(episode, read, value => value?.endsWith('.mkv') ? new URL(value) : null)
  assert.equal(other.href, base + 'Harbour.S02E03.mkv')
})
