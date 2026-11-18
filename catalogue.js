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
      if (url.hostname === 'images.metahub.space') {
        url.pathname = url.pathname.replace('/poster/small/', '/poster/medium/')
      }
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

async function list(kind, { query, genre, page, signal }) {
  const filters = []
  if (query) filters.push('search=' + encodeURIComponent(query))
  if (genre) filters.push('genre=' + encodeURIComponent(genre))
  if (page > 1) filters.push('skip=' + ((page - 1) * pageSize))
  const data = await read('/catalog/' + kind + '/top' + (filters.length ? '/' + filters.join('&') : '') + '.json', signal)
  if (!Array.isArray(data.metas)) throw new Error('The catalogue returned an unreadable response.')
  return data.metas.map(meta => normalize(meta, kind)).filter(Boolean)
}

export async function browse(options) {
  const items = await list(options.kind, options)
  return { items: items.slice(0, pageSize), hasNext: items.length > pageSize }
}

export async function search(query, signal) {
  const results = await Promise.allSettled([...kinds].map(kind => list(kind, { query, page: 1, signal })))
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
        title: string(video.name) || 'Episode ' + episode
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
