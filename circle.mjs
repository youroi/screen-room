import { circleVideo, findCircleStream, circleWebOrigins } from './public/playback.js'

export function createCircle({ origins = circleWebOrigins, doFetch = fetch } = {}) {
  let working = origins[0]
  const allowedOrigins = new Set(origins)

  async function read(path) {
    const bases = [working, ...origins.filter(base => base !== working)]
    let missingPost = false
    for (const base of bases) {
      try {
        const response = await doFetch(new URL(path, base), {
          headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000)
        })
        if (response.ok && (response.headers.get('content-type') ?? '').includes('application/json')) {
          const data = await response.json()
          working = base
          return data
        }
        missingPost ||= response.status === 404 && !path.includes('?')
        await response.body?.cancel()
      } catch {}
    }
    if (missingPost) return null
    throw Object.assign(new Error('Could not reach Circle from this network.'), { status: 502 })
  }

  return {
    resolve: item => findCircleStream(item, read, address => circleVideo(address, allowedOrigins)),
    openVideo(address, { method, range, signal }) {
      const headers = { 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      if (range) headers.range = range
      return doFetch(address, { headers, method, redirect: 'error', signal })
    }
  }
}
