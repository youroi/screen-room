const circleOrigins = ['http://new.circleftp.net:5000', 'http://15.1.1.50:5000']
const circleIps = new Set(['15.1.1.1', '15.1.1.4', '15.1.1.5', '15.1.1.50', '103.170.204.84'])
const supportedTypes = { singleVideo: 'movie', series: 'series' }
const videoTypes = new Map([
  ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['mkv', 'video/x-matroska'],
  ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['avi', 'video/x-msvideo']
])
export const pageSize = 18
export const categories = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '21', '22', '85'])
export const titleId = /^\d{1,12}$/

function text(value, max = 240) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : ''
}

export function assetPath(value) {
  if (typeof value !== 'string' || value.length > 600) return null
  const parts = (URL.parse(value)?.pathname ?? value).replace(/^\/?(?:uploads\/)?/, '').split('/')
  try {
    const decoded = parts.map(decodeURIComponent)
    if (!decoded.every(part => part && part !== '.' && part !== '..' && !/[\/\\\x00-\x1f]/.test(part))) return null
    if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(decoded.at(-1))) return null
    return decoded.map(encodeURIComponent).join('/')
  } catch {
    return null
  }
}

export function mediaType(address) {
  return videoTypes.get(address.pathname.split('.').at(-1).toLowerCase())
}

function normalizePost(post, id = text(post?.id)) {
  const kind = Object.hasOwn(supportedTypes, post?.type) ? supportedTypes[post.type] : null
  const title = text(post?.name) || text(post?.title)
  if (!kind || !titleId.test(id) || !title) return null
  return {
    id, kind, title,
    year: text(post.year).match(/\b(?:19|20)\d{2}\b/)?.[0] ?? '',
    quality: text(post.quality, 24),
    artwork: assetPath(post.imageSm ?? post.image)
  }
}

export function createCircle({ origins = circleOrigins, doFetch = fetch } = {}) {
  let working = origins[0]
  const originSet = new Set(origins)
  const detailCache = new Map()

  function videoUrl(value) {
    const url = typeof value === 'string' ? URL.parse(value.trim()) : null
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
        !mediaType(url)) return null
    const { hostname, port } = url
    if (originSet.has(url.origin)) return url
    if ((hostname === 'circleftp.net' || hostname.endsWith('.circleftp.net') || circleIps.has(hostname)) &&
        ['', '80', '443', '5000', '8080', '8096'].includes(port)) return url
    return null
  }

  async function upstream(path, accept, signal) {
    const bases = [working, ...origins.filter(base => base !== working)]
    let notFound = false
    for (const base of bases) {
      try {
        const response = await doFetch(new URL(path, base), {
          headers: { accept }, redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)
        })
        if (response.ok && (response.headers.get('content-type') ?? '').includes(accept)) {
          working = base
          return response
        }
        notFound ||= response.status === 404
        await response.body?.cancel()
      } catch (error) {
        if (signal?.aborted) throw error
      }
    }
    if (notFound) throw Object.assign(new Error('This item is no longer available.'), { status: 404 })
    throw Object.assign(new Error('Could not reach Circle. Check your BDIX connection and try again.'), { status: 502 })
  }

  async function catalog({ page, query, category }) {
    const params = new URLSearchParams({ page: String(page), order: 'desc', limit: String(pageSize) })
    if (query) params.set('searchTerm', query)
    if (category) params.set('categoryExact', category)
    const response = await upstream('/api/posts?' + params, 'application/json')
    const data = await response.json()
    if (!Array.isArray(data?.posts)) throw Object.assign(new Error('Circle returned an unreadable catalogue.'), { status: 502 })
    const seen = new Set()
    const items = data.posts.flatMap(post => {
      const item = normalizePost(post)
      if (!item || seen.has(item.id)) return []
      seen.add(item.id)
      return [item]
    })
    const pages = Number(data.totalPages ?? data.pagination?.totalPages)
    return { items, hasNext: Number.isInteger(pages) && pages >= 0 ? page < pages : data.posts.length >= pageSize }
  }

  async function title(id) {
    const cached = detailCache.get(id)
    if (cached?.expires > Date.now()) return cached.title

    const response = await upstream('/api/posts/' + id, 'application/json')
    const data = await response.json()
    const post = normalizePost(data, id)
    if (!post) throw Object.assign(new Error('This title is unavailable.'), { status: 404 })

    const streams = new Map()
    const seasons = []
    function addStream(key, value) {
      const address = videoUrl(value)
      if (address) streams.set(key, address)
      return address !== null
    }

    if (post.kind === 'movie') addStream('movie', data.content)
    if (post.kind === 'series' && Array.isArray(data.content)) {
      for (const [seasonIndex, season] of data.content.entries()) {
        const episodes = []
        for (const [episodeIndex, episode] of (Array.isArray(season?.episodes) ? season.episodes : []).entries()) {
          const key = seasonIndex + '-' + episodeIndex
          if (addStream(key, episode?.link)) episodes.push({ key, title: text(episode.title) || 'Episode ' + (episodeIndex + 1) })
        }
        if (episodes.length) seasons.push({ name: text(season.seasonName, 70) || 'Season ' + (seasonIndex + 1), episodes })
      }
    }

    const result = {
      streams,
      info: {
        ...post,
        artwork: assetPath(data.image) ?? post.artwork,
        description: text(typeof data.metaData === 'object' ? data.metaData?.description : data.metaData, 1600),
        duration: text(data.watchTime, 32),
        playable: streams.has('movie'),
        seasons
      }
    }
    if (detailCache.size >= 120) detailCache.delete(detailCache.keys().next().value)
    detailCache.set(id, { title: result, expires: Date.now() + 300_000 })
    return result
  }

  return {
    catalog, title,
    picture: (path, signal) => upstream('/uploads/' + path, 'image/', signal),
    async openVideo(address, options) {
      const headers = { 'Accept-Encoding': 'identity' }
      if (options.range) headers.range = options.range
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      return doFetch(address, { headers, method: options.method, redirect: 'error', signal: options.signal })
    }
  }
}
