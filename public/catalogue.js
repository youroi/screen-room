const origin = 'https://v3-cinemeta.strem.io'
const artworkHosts = new Set(['images.metahub.space', 'image.tmdb.org', 'episodes.metahub.space'])
const pageSize = 18
export const imdbId = /^tt\d{5,12}$/
export const kinds = new Set(['movie', 'series'])

function string(value, max = 280) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function image(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && artworkHosts.has(url.hostname) && !url.username && !url.password) {
      return url.href
    }
  } catch {}
  return null
}

async function read(path, signal) {
  const response = await fetch(origin + path, { credentials: 'omit', signal })
  if (!response.ok) throw new Error(response.status === 404 ? 'This title could not be found.' : 'Try again in a moment.')
  return response.json()
}

function normalize(meta, kind) {
  if (!imdbId.test(meta?.id) || !string(meta.name)) return null
  const year = /\b(?:19|20)\d{2}\b/.exec(string(meta.releaseInfo ?? meta.year))?.[0] ?? ''
  return {
    id: meta.id, kind, title: string(meta.name), year, artwork: image(meta.poster),
    description: string(meta.description, 1800), duration: string(meta.runtime, 32),
    genres: (Array.isArray(meta.genres) ? meta.genres : []).slice(0, 3).map(value => string(value, 40)).filter(Boolean)
  }
}

export function releaseDay(value) {
  const date = string(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(+parsed) && parsed.toISOString().startsWith(date) ? date : ''
}

function hasCinemetaRelease(meta, kind, today) {
  const dates = [meta.released]
  if (kind === 'series' && Array.isArray(meta.videos)) {
    const first = meta.videos.find(episode => episode?.season === 1 && episode.episode === 1)
    dates.push(first?.released)
  }
  return dates.map(releaseDay).some(date => date && date <= today)
}

async function list(kind, { query, genre, page, signal }) {
  const filters = []
  if (query) filters.push('search=' + encodeURIComponent(query))
  if (genre) filters.push('genre=' + encodeURIComponent(genre))
  if (page > 1) filters.push('skip=' + ((page - 1) * pageSize))
  const data = await read('/catalog/' + kind + '/top' + (filters.length ? '/' + filters.join('&') : '') + '.json', signal)
  if (!Array.isArray(data.metas)) throw new Error('The catalogue returned an unreadable response.')
  return data.metas
}

export async function browse(options) {
  const source = await list(options.kind, options)
  const today = new Date().toISOString().slice(0, 10)
  const items = source.slice(0, pageSize).filter(meta => meta && hasCinemetaRelease(meta, options.kind, today))
  return { items: items.map(meta => normalize(meta, options.kind)).filter(Boolean), hasNext: source.length > pageSize }
}

function picks(kind, entries) {
  return entries.map(([id, title]) => ({
    id, kind, title, artwork: 'https://images.metahub.space/poster/small/' + id + '/img'
  }))
}

export const fallbackFeatured = [
  ...picks('movie', [['tt37287335', 'Obsession']]),
  ...picks('series', [['tt31510819', 'MobLand']]),
  ...picks('movie', [['tt14205554', 'KPop Demon Hunters'], ['tt22084616', 'Spider-Man: Brand New Day']]),
  ...picks('series', [['tt27995113', 'Black Doves']]),
  ...picks('movie', [['tt32820897', 'Demon Slayer: Infinity Castle']])
]

const curatedCollections = [
  {
    key: 'animation',
    items: [
      ...picks('series', [['tt21209876', 'Solo Leveling']]),
      ...picks('movie', [['tt32820897', 'Demon Slayer: Infinity Castle']]),
      ...picks('series', [
        ['tt22248376', "Frieren: Beyond Journey’s End"],
        ['tt11126994', 'Arcane'],
        ['tt12343534', 'Jujutsu Kaisen']
      ]),
      ...picks('movie', [
        ['tt30472557', 'Chainsaw Man – The Movie: Reze Arc'],
        ['tt9362722', 'Spider-Man: Across the Spider-Verse']
      ]),
      ...picks('series', [
        ['tt13309742', 'Blue Eye Samurai'],
        ['tt26743760', 'The Apothecary Diaries'],
        ['tt2560140', 'Attack on Titan']
      ]),
      ...picks('movie', [
        ['tt29623480', 'The Wild Robot'],
        ['tt14205554', 'KPop Demon Hunters']
      ])
    ]
  },
  {
    key: 'k-dramas',
    items: picks('series', [
      ['tt26471411', 'When Life Gives You Tangerines'],
      ['tt24640580', 'Moving'],
      ['tt20234568', 'Weak Hero'],
      ['tt31324295', 'Lovely Runner'],
      ['tt27446493', 'Twinkling Watermelon'],
      ['tt21344706', 'The Glory'],
      ['tt27668559', 'Queen of Tears'],
      ['tt36724865', 'Our Unwritten Seoul'],
      ['tt28106730', 'The Trauma Code: Heroes on Call'],
      ['tt7923710', 'My Mister'],
      ['tt10850932', 'Crash Landing on You'],
      ['tt11769304', 'Hospital Playlist']
    ])
  }
]

export const collections = [
  { key: 'movie', label: 'Popular Movies', field: 'popularMovies' },
  { key: 'series', label: 'Popular Series', field: 'popularSeries' },
  { key: 'trending', label: 'Trending This Week', field: 'trending' },
  { key: 'latest', label: 'Latest Releases', field: 'latest' },
  { key: 'animation', label: 'Animation', field: 'animation' },
  { key: 'k-dramas', label: 'K-Dramas', field: 'kDramas' }
]

function snapshotItems(items, limit) {
  return items.flatMap(item => {
    const title = string(item?.title)
    const artwork = image(item?.artwork)
    return imdbId.test(item?.id) && kinds.has(item.kind) && title && artwork
      ? [{ id: item.id, kind: item.kind, title, artwork }] : []
  }).slice(0, limit)
}

export async function refreshedCollections(signal) {
  const response = await fetch(new URL('./catalogue-snapshot.json', import.meta.url), { signal, credentials: 'omit' })
  if (!response.ok) throw new Error('The catalogue snapshot is unavailable.')
  const data = await response.json()
  const legacy = data?.version === 3
  const required = legacy ? collections.slice(0, 4) : collections
  if ((!legacy && data?.version !== 4) || !required.every(row => Array.isArray(data[row.field]))) {
    throw new Error('Invalid catalogue snapshot.')
  }

  const featured = Array.isArray(data.featured) ? snapshotItems(data.featured, 6) : []
  return {
    featured: featured.length === 6 ? featured : fallbackFeatured,
    rows: collections.map(({ key, field }) => {
      const items = data[field] ?? curatedCollections.find(row => row.key === key)?.items ?? []
      return [key, snapshotItems(key === 'latest' ? items.filter(item => item?.releaseType === 'digital') : items, 30)]
    })
  }
}

export const offlineCollections = curatedCollections.map(({ key, items }) => [key, items])

export async function search(query, signal) {
  const results = await Promise.allSettled([...kinds].map(async kind =>
    (await list(kind, { query, page: 1, signal })).map(meta => normalize(meta, kind)).filter(Boolean)))
  if (results.every(result => result.status === 'rejected')) throw results[0].reason
  const normalizedQuery = query.toLowerCase()
  const rank = item => item.title.toLowerCase() === normalizedQuery ? 0 : item.title.toLowerCase().startsWith(normalizedQuery) ? 1 : 2
  return {
    items: results.flatMap(result => result.status === 'fulfilled' ? result.value.slice(0, 24) : [])
      .sort((a, b) => rank(a) - rank(b)).slice(0, 32),
    hasNext: false
  }
}

export async function title(kind, id, signal) {
  const data = await read('/meta/' + kind + '/' + id + '.json', signal)
  const item = normalize(data.meta, kind)
  if (!item) throw new Error('This title could not be found.')
  const seasons = new Map()
  if (kind === 'series' && Array.isArray(data.meta.videos)) {
    for (const video of data.meta.videos) {
      const { season, episode } = video ?? {}
      if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) continue
      if (!seasons.has(season)) seasons.set(season, new Map())
      const episodes = seasons.get(season)
      if (!episodes.has(episode)) episodes.set(episode, {
        key: season + '-' + episode, season, number: episode,
        title: string(video.name) || 'Episode ' + episode, artwork: image(video.thumbnail)
      })
    }
  }
  return {
    ...item,
    seasons: [...seasons].sort(([a], [b]) => a - b).map(([season, episodes]) => ({
      name: 'Season ' + season,
      episodes: [...episodes.values()].sort((a, b) => a.number - b.number)
    }))
  }
}
