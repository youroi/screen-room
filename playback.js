export const circleWebOrigins = ['http://new.circleftp.net:5000', 'http://15.1.1.50:5000']
const circleIps = new Set(['15.1.1.1', '15.1.1.4', '15.1.1.5', '15.1.1.50', '103.170.204.84'])
const mediaTypes = new Map([
  ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['mkv', 'video/x-matroska'],
  ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['avi', 'video/x-msvideo']
])

export function mediaType(url) {
  return mediaTypes.get(url.pathname.split('.').at(-1).toLowerCase())
}

export async function probeByteRange(source, signal) {
  const controller = new AbortController()
  try {
    const response = await fetch(source, {
      headers: { Range: 'bytes=1-1' }, cache: 'no-store', credentials: 'omit', redirect: 'error',
      signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(2000)])
    })
    const range = response.headers.get('content-range')
    const type = response.headers.get('content-type') ?? ''
    const status = response.status
    const ignored = status === 200 && !/^(text\/html|application\/json)/i.test(type)
    return { status, range, ignored }
  } catch (error) {
    return { error: error.name }
  } finally {
    // Stop after the headers even if the server started sending the entire file.
    controller.abort()
  }
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
    ? value.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').toLowerCase()
      .replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
    : ''
}

function movieYear(value) {
  return /\b(?:19|20)\d{2}\b/.exec(String(value ?? ''))?.[0]
}

function release(value) {
  const name = normalized(value).replace(/ (?:[248]k|\d{3,4}p|blu ?ray|brrip|web ?(?:dl|rip)|hdtv|remux|[xh] *26[45]|hevc|av1|(?:dual|multi) audio)(?: .*)?$/, '')
  const raw = typeof value === 'string' ? value : ''
  const tagged = /[\[(]((?:19|20)\d{2})[\])]|\s+((?:19|20)\d{2})\s*\[/.exec(raw)
  const base = tagged && normalized(raw.slice(0, tagged.index))
  if (base) return { name, base, year: tagged[1] ?? tagged[2] }
  const suffix = /^(.+) ((?:19|20)\d{2})$/.exec(name)
  return { name, base: suffix?.[1], year: suffix?.[2] }
}

function episodeLinks(content, season, episode) {
  if (!Array.isArray(content)) return []
  const groups = content.map(group => ({
    season: Number(/^(?:(?:season|s)[\s_.-]*)?(\d+)\b/i.exec(group?.seasonName?.trim?.() ?? '')?.[1]),
    episodes: Array.isArray(group?.episodes) ? group.episodes : []
  }))
  const positional = groups.every(group => !group.season)
  return groups.flatMap((group, index) => {
    const isSeason = group.season === season || (positional && index + 1 === season)
    if (group.season && !isSeason) return []
    const numbered = group.episodes.map(entry => {
      const file = typeof entry?.link === 'string' ? entry.link.split(/[?#]/, 1)[0].split('/').at(-1) : ''
      const fields = [normalized(entry?.title), normalized(file.replace(/%20/gi, ' '))]
      const explicit = fields.map(field => /\b(?:(?:season|s) *(\d{1,3}) *(?:episode|ep|e) *(\d{1,4})|(\d{1,3}) *x *(\d{1,4}))\b/.exec(field)).filter(Boolean)
      const count = fields.map(field => /\b(?:episode|ep|e) *(\d{1,4})\b/.exec(field)).filter(Boolean)
      const matches = explicit.length
        ? explicit.every(match => Number(match[1] ?? match[3]) === season && Number(match[2] ?? match[4]) === episode)
        : isSeason && count.length && count.every(match => Number(match[1]) === episode)
      return { link: entry?.link, matches, numbered: explicit.length || count.length }
    })
    if (isSeason && numbered.every(entry => !entry.numbered)) return [numbered[episode - 1]?.link]
    return numbered.filter(entry => entry.matches).map(entry => entry.link)
  })
}

async function verifiedAliases(id, signal) {
  if (!/^tt\d{5,12}$/.test(id ?? '')) return []
  const timeout = AbortSignal.timeout(4000)
  const settings = { credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }
  async function wikidata(params) {
    const response = await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ ...params, format: 'json', origin: '*' }), settings)
    if (!response.ok) throw new Error('Alias lookup failed')
    return response.json()
  }
  try {
    const lookup = await wikidata({ action: 'query', list: 'search', srsearch: 'haswbstatement:P345=' + id, srnamespace: '0', srlimit: '3' })
    const ids = (lookup.query?.search ?? []).map(entry => entry.title).filter(title => /^Q\d+$/.test(title))
    if (!ids.length) return []
    const data = await wikidata({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|aliases',
      languages: 'en|en-gb|en-us|bn|ko|ja|zh|zh-hans|zh-hant|hi|es|fr|de|it|ru|tr|ta|te|ml|kn|th|id|ar' })
    const values = (entity, property) => (entity.claims?.[property] ?? [])
      .filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value)
    return Object.values(data.entities ?? {}).filter(entity => values(entity, 'P345').includes(id)).flatMap(entity => [
      ...values(entity, 'P1476').map(title => title?.text),
      ...values(entity, 'P1705').map(title => title?.text),
      ...['en', 'en-gb', 'en-us', 'bn'].flatMap(language => (entity.aliases?.[language] ?? []).map(alias => alias.value)),
      ...Object.values(entity.labels ?? {}).map(label => label.value),
      ...Object.values(entity.aliases ?? {}).flat().map(alias => alias.value)
    ]).filter(title => typeof title === 'string' && title.trim() && title.length <= 280)
  } catch {
    return []
  }
}

export async function findCircleStream(item, read, validate = circleVideo, signal) {
  const type = item.kind === 'series' ? 'series' : 'singleVideo'
  const target = normalized(item.title)
  if (!target) return null
  const titles = new Set([target])
  const posts = new Map()
  const checked = new Set()

  async function lookup(searchTerm) {
    const listing = await read('/api/posts?' + new URLSearchParams({ searchTerm, order: 'desc', limit: '30' }))
    if (!Array.isArray(listing?.posts)) throw new Error('Circle returned an unreadable response.')
    return listing.posts.filter(post => post?.type === type && /^\d{1,12}$/.test(String(post.id)))
  }

  async function resolve() {
    const matches = [...posts].flatMap(([id, post]) => {
      const sourceId = post.imdbId ?? post.imdb_id
      if (item.id && /^tt\d+$/.test(sourceId ?? '')) return sourceId === item.id ? [{ id, score: 10 }] : []
      const name = release(post.name)
      const title = release(post.title)
      const full = titles.has(normalized(post.name)) || titles.has(normalized(post.title))
      const clean = titles.has(name.name) || titles.has(title.name)
      if (!full && !clean && !titles.has(name.base) && !titles.has(title.base)) return []
      const year = movieYear(post.year) ?? (titles.has(title.name) ? undefined : title.year) ??
        (titles.has(name.name) ? undefined : name.year)
      if (year && item.year && year !== item.year) return []
      return [{ id, score: (year && year === item.year ? 4 : 0) + (full ? 3 : clean ? 2 : 1) }]
    }).sort((a, b) => b.score - a.score)

    for (const match of matches) {
      if (checked.has(match.id)) continue
      if (signal?.aborted || checked.size === 10) return null
      checked.add(match.id)
      const details = await read('/api/posts/' + match.id)
      const links = item.kind === 'movie' ? [details?.content] : episodeLinks(details?.content, item.season, item.episode)
      for (const link of links) {
        const source = validate(link)
        if (source) return source
      }
    }
    return null
  }

  function remember(listing) {
    for (const post of listing) if (!posts.has(String(post.id))) posts.set(String(post.id), post)
  }

  remember(await lookup(item.title))
  const first = await resolve()
  if (first || signal?.aborted) return first

  const aliases = await verifiedAliases(item.id, signal)
  const terms = []
  for (const name of aliases) {
    const key = normalized(name)
    if (key && !titles.has(key)) {
      titles.add(key)
      terms.push(name.trim())
    }
  }
  const fromListing = await resolve()
  if (fromListing || signal?.aborted) return fromListing

  if (item.title.toLowerCase() !== target) terms.unshift(target)
  const results = await Promise.allSettled(terms.slice(0, 6).map(lookup))
  for (const result of results) if (result.status === 'fulfilled') remember(result.value)
  return resolve()
}

export async function browserCircleStream(item, signal, tabOrigin, tried = new Set()) {
  if (!circleWebOrigins.includes(tabOrigin)) throw new Error('Open the Circle tab to play this title.')
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(9000)])
  let source
  try {
    source = await findCircleStream(item, async path => {
      const response = await fetch(tabOrigin + path, { signal: requestSignal, credentials: 'omit', redirect: 'error' })
      if (response.status === 404 && !path.includes('?')) return null
      if (!response.ok) throw new Error('Circle request failed')
      return response.json()
    }, link => {
      const url = circleVideo(link)
      return url && !tried.has(url.href) ? url : null
    }, requestSignal)
    if (!source && requestSignal.aborted) throw requestSignal.reason
  } catch (error) {
    if (signal.aborted) throw error
    if (requestSignal.aborted) throw new Error('Circle took too long to find a stream. Try again.')
    throw new Error('Could not reach Circle from this connection.')
  }
  if (!source) throw new Error(tried.size ? 'No other matching Circle stream was found.' : 'No matching Circle stream was found.')
  return source.href
}
