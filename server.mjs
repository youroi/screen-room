import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assetPath, categories, createCircle, mediaType, titleId } from './circle.mjs'
import { addressSpace, pagesOrigin } from './public/connection.js'

const assets = new Map([
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/connection.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
  ['/mark.svg', 'image/svg+xml'],
  ['/bricolage.ttf', 'font/ttf']
].map(([path, type]) => [path, { type, bytes: readFileSync(new URL('./public' + path, import.meta.url)) }]))
const index = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')
  .replaceAll('href="./', 'href="/')
  .replaceAll('src="./', 'src="/')
const contentHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}

export function createApp(circle = createCircle()) {
  return createServer(async (request, response) => {
    const method = request.method
    const url = URL.parse(request.url ?? '/', 'http://screenroom.local')
    const path = url?.pathname

    function json(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
    }

    async function stream(upstream, headers) {
      response.writeHead(upstream.status, headers)
      if (method === 'HEAD' || !upstream.body) return response.end()
      await pipeline(Readable.fromWeb(upstream.body), response)
    }

    if (!path) return json(400, { error: 'Invalid request.' })
    const host = URL.parse('http://' + request.headers.host)
    if (!host || !addressSpace(host.hostname)) return json(403, { error: 'Open Screen Room using a local address.' })

    const origin = request.headers.origin
    if (origin && origin !== pagesOrigin && origin !== host.origin) {
      return json(403, { error: 'Origin not allowed.' })
    }
    if (!origin && request.headers['sec-fetch-site'] === 'cross-site' && /^\/(?:api|art|video)\//.test(path)) {
      return json(403, { error: 'Origin not allowed.' })
    }
    response.setHeader('Vary', 'Origin')
    if (origin === pagesOrigin) response.setHeader('Access-Control-Allow-Origin', pagesOrigin)

    if (method === 'OPTIONS' && origin === pagesOrigin) {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Max-Age': '600'
      })
      return response.end()
    }
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Method not allowed.' })

    try {
      if (path === '/api/ready') return json(200, { app: 'Screen Room' })
      if (path === '/api/catalog') {
        const page = Number(url.searchParams.get('page') ?? '1')
        const query = (url.searchParams.get('q') ?? '').trim()
        const category = url.searchParams.get('category')
        if (!Number.isInteger(page) || page < 1 || page > 1000 || query.length > 100 || (category && !categories.has(category))) {
          return json(400, { error: 'Invalid catalogue filters.' })
        }
        return json(200, await circle.catalog({ page, query, category }))
      }

      const [, route, id, part] = path.split('/')
      if (route === 'api' && id === 'titles' && titleId.test(part ?? '') && path === '/api/titles/' + part) {
        return json(200, (await circle.title(part)).info)
      }

      if (path.startsWith('/art/')) {
        const image = assetPath(path.slice(5))
        if (!image) return json(404, { error: 'Artwork not found.' })
        const upstream = await circle.picture(image)
        const type = upstream.headers.get('content-type').split(';')[0]
        if (!/^image\/(?:avif|gif|jpeg|png|webp)$/.test(type)) {
          await upstream.body?.cancel()
          return json(404, { error: 'Artwork not found.' })
        }
        return await stream(upstream, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
      }

      if (route === 'video' && titleId.test(id ?? '') && /^(?:movie|\d{1,4}-\d{1,4})$/.test(part ?? '') &&
          path === '/video/' + id + '/' + part) {
        const { range } = request.headers
        if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json(416, { error: 'Invalid byte range.' })
        const { streams } = await circle.title(id)
        const address = streams.get(part)
        if (!address) return json(404, { error: 'Video unavailable.' })

        const controller = new AbortController()
        response.once('close', () => controller.abort())
        const timer = setTimeout(() => controller.abort(), 9000)
        let upstream
        try {
          upstream = await circle.openVideo(address, { method, range, signal: controller.signal })
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
        const headers = { 'Content-Type': mediaType(address), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
        for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const value = upstream.headers.get(name)
          if (value) headers[name] = value
        }
        return await stream(upstream, headers)
      }

      const asset = assets.get(path)
      if (asset) {
        response.writeHead(200, { ...contentHeaders, 'Content-Type': asset.type })
        return response.end(method === 'HEAD' ? undefined : asset.bytes)
      }
      if (path === '/' || path === '/search' || /^\/(?:title|watch)\/\d{1,12}$/.test(path)) {
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
  const host = process.env.SCREENROOM_HOST ?? '127.0.0.1'
  createApp().listen(port, host, () => console.log('Screen Room is running at http://' + host + ':' + port))
}
