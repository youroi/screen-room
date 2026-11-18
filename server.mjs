import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createCircle } from './circle.mjs'
import { mediaType } from './public/playback.js'

const assets = new Map([
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/catalogue.js', 'text/javascript; charset=utf-8'],
  ['/playback.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
  ['/mark.svg', 'image/svg+xml'],
  ['/bricolage.ttf', 'font/ttf']
].map(([path, type]) => [path, { type, bytes: readFileSync(new URL('./public' + path, import.meta.url)) }]))
const index = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')
  .replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/')
const htmlRoute = /^\/(?:title|watch)\/(?:movie|series)\/tt\d{5,12}$/
const videoRoute = /^\/video\/([a-f\d-]{36})$/
const contentHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; connect-src 'self' https://v3-cinemeta.strem.io https://cinemeta-catalogs.strem.io; img-src 'self' https://images.metahub.space https://live.metahub.space https://image.tmdb.org https://episodes.metahub.space",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}

export function createApp(circle = createCircle()) {
  const streams = new Map()

  return createServer(async (request, response) => {
    const method = request.method
    const url = URL.parse(request.url ?? '/', 'http://screenroom.local')
    const path = url?.pathname

    function json(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
    }

    if (!path) return json(400, { error: 'Invalid request.' })
    const host = URL.parse('http://' + request.headers.host)
    if (!host || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) ||
        (request.headers.origin && request.headers.origin !== host.origin) ||
        request.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Origin not allowed.' })
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Method not allowed.' })

    try {
      if (path === '/api/play') {
        const params = url.searchParams
        const kind = params.get('kind')
        const id = params.get('id') ?? ''
        const title = (params.get('title') ?? '').trim()
        const year = params.get('year') ?? ''
        const season = Number(params.get('season'))
        const episode = Number(params.get('episode'))
        if (!['movie', 'series'].includes(kind) || (id && !/^tt\d{5,12}$/.test(id)) || !title || title.length > 280 || (year && !/^\d{4}$/.test(year)) ||
            (kind === 'series' && (![season, episode].every(n => Number.isInteger(n) && n > 0 && n <= 5000)))) {
          return json(400, { error: 'Invalid title or episode.' })
        }

        const address = await circle.resolve({ kind, id, title, year, season, episode })
        if (!address) return json(404, { error: 'No matching Circle stream was found.' })
        if (streams.size >= 120) streams.delete(streams.keys().next().value)
        const key = randomUUID()
        streams.set(key, { address, expires: Date.now() + 28_800_000 })
        return json(200, { src: '/video/' + key })
      }

      const video = videoRoute.exec(path)
      if (video) {
        const stream = streams.get(video[1])
        if (!stream || stream.expires <= Date.now()) return json(404, { error: 'Video unavailable.' })
        const { range } = request.headers
        if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json(416, { error: 'Invalid byte range.' })
        const controller = new AbortController()
        response.once('close', () => controller.abort())
        const timer = setTimeout(() => controller.abort(), 9000)
        let upstream
        try {
          upstream = await circle.openVideo(stream.address, { method, range, signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
        if (![200, 206, 416].includes(upstream.status)) {
          await upstream.body?.cancel()
          return json(502, { error: 'Circle could not open this video.' })
        }
        const type = upstream.headers.get('content-type') ?? ''
        const encoding = upstream.headers.get('content-encoding')
        if ((encoding && encoding !== 'identity') ||
            (upstream.status !== 416 && type && !/^(?:video\/|application\/octet-stream)/i.test(type))) {
          await upstream.body?.cancel()
          return json(502, { error: 'Circle returned a non-video response.' })
        }
        const headers = { 'Content-Type': mediaType(stream.address), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
        for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const value = upstream.headers.get(name)
          if (value) headers[name] = value
        }
        response.writeHead(upstream.status, headers)
        if (method === 'HEAD' || !upstream.body) return response.end()
        return await pipeline(Readable.fromWeb(upstream.body), response)
      }

      const asset = assets.get(path)
      if (asset) {
        response.writeHead(200, { ...contentHeaders, 'Content-Type': asset.type })
        return response.end(method === 'HEAD' ? undefined : asset.bytes)
      }
      if (path === '/' || path === '/search' || htmlRoute.test(path)) {
        response.writeHead(200, { ...contentHeaders, 'Content-Type': 'text/html; charset=utf-8' })
        return response.end(method === 'HEAD' ? undefined : index)
      }
      return json(404, { error: 'Page not found.' })
    } catch (error) {
      if (response.headersSent || response.destroyed) return response.destroy()
      return json(error.status ?? 502, {
        error: error.status ? error.message : 'Circle did not return a playable response. Try again.'
      })
    }
  })
}

if (import.meta.main) {
  const port = Number(process.env.SCREENROOM_PORT ?? 4174)
  createApp().listen(port, '127.0.0.1', () => console.log('Screen Room is running at http://127.0.0.1:' + port))
}
