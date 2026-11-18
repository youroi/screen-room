const circleOrigin = 'https://new.circleftp.net:5000'
const circleIps = new Set(['15.1.1.1', '15.1.1.4', '15.1.1.5', '15.1.1.50', '103.170.204.84'])
const mediaTypes = new Map([
  ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['mkv', 'video/x-matroska'],
  ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['avi', 'video/x-msvideo']
])

export function mediaType(url) {
  return mediaTypes.get(url.pathname.split('.').at(-1).toLowerCase())
}

export function circleVideo(value, allowedOrigins = new Set()) {
  if (typeof value !== 'string') return null
  let url
  try { url = new URL(value.trim()) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !mediaType(url)) return null
  if (allowedOrigins.has(url.origin)) return url
  const { hostname, port } = url
  if ((hostname === 'circleftp.net' || hostname.endsWith('.circleftp.net') || circleIps.has(hostname)) &&
      ['', '80', '443', '5000', '8080', '8096'].includes(port)) return url
  return null
}

function normalized(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : ''
}

function movieYear(value) {
  return /\b(?:19|20)\d{2}\b/.exec(String(value ?? ''))?.[0]
}

function release(value) {
  const raw = String(value ?? '')
  const suffix = /\s*[\[(]((?:19|20)\d{2})[\])]/.exec(raw) ??
    /\s+((?:19|20)\d{2})(?:\s+\[|\s*$)/.exec(raw)
  return { name: normalized(suffix ? raw.slice(0, suffix.index) : raw), year: suffix?.[1] }
}

function episodeLink(content, season, episode) {
  if (!Array.isArray(content)) return null
  const seasonNumber = entry => Number(/(?:season|\bs)\s*0*(\d+)/i.exec(entry?.seasonName ?? '')?.[1])
  const match = content.find(entry => seasonNumber(entry) === season) ??
    (content.every(entry => !seasonNumber(entry)) ? content[season - 1] : null)
  if (!Array.isArray(match?.episodes)) return null
  const episodeNumber = entry => Number(/(?:s\d{1,3}[\s_.-]*e|\b(?:episode|ep|e)[\s_.-]*)0*(\d{1,4})/i
    .exec((entry?.title ?? '') + ' ' + (entry?.link ?? ''))?.[1])
  return (match.episodes.find(entry => episodeNumber(entry) === episode) ??
    (match.episodes.every(entry => !episodeNumber(entry)) ? match.episodes[episode - 1] : null))?.link
}

export async function findCircleStream(item, read, validate = circleVideo) {
  const type = item.kind === 'series' ? 'series' : 'singleVideo'
  const target = normalized(item.title)
  const listing = await read('/api/posts?' + new URLSearchParams({ searchTerm: item.title, order: 'desc', limit: '30' }))
  if (!Array.isArray(listing?.posts)) throw new Error('Circle returned an unreadable response.')
  const matches = listing.posts.flatMap(post => {
    if (post?.type !== type || !/^\d{1,12}$/.test(String(post.id))) return []
    const parsed = release(post.title)
    const year = movieYear(post.year) ?? parsed.year
    if (year && item.year && year !== item.year) return []
    const fullMatch = normalized(post.name) === target || normalized(post.title) === target
    if (!fullMatch && parsed.name !== target) return []
    return [{ id: post.id, score: Number(fullMatch) * 2 + Number(year === item.year) }]
  }).sort((a, b) => b.score - a.score).slice(0, 4)

  for (const match of matches) {
    const details = await read('/api/posts/' + match.id)
    const source = validate(item.kind === 'movie' ? details?.content : episodeLink(details?.content, item.season, item.episode))
    if (source) return source
  }
  return null
}

export async function hostedCircleStream(item, signal) {
  // shortcut: hosted playback uses direct HTTPS, extend if Circle publishes another browser-readable origin.
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(4500)])
  let source
  try {
    source = await findCircleStream(item, async path => {
      const response = await fetch(circleOrigin + path, { signal: requestSignal, credentials: 'omit', redirect: 'error' })
      if (response.status === 404 && !path.includes('?')) return null
      if (!response.ok) throw new Error('Circle request failed')
      return response.json()
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('Circle playback is unavailable from this browser.')
  }
  if (!source) throw new Error('No matching Circle stream was found.')
  if (source.protocol !== 'https:') throw new Error('This Circle video uses HTTP, which this page cannot open.')
  return source.href
}
