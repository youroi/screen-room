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

function picks(kind, entries) {
  return entries.map(([id, title]) => ({
    id, kind, title, artwork: 'https://images.metahub.space/poster/small/' + id + '/img'
  }))
}

export const featured = picks('movie', [
  ['tt0118694', 'In the Mood for Love'],
  ['tt27503384', 'Perfect Days'],
  ['tt13238346', 'Past Lives'],
  ['tt0064116', 'Once Upon a Time in the West']
])

export const collections = [
  {
    key: 'top-rated',
    label: 'Top Rated Movies',
    // IMDb Top 250 order recorded on 15 November 2026.
    items: picks('movie', [
      ['tt0111161', 'The Shawshank Redemption'], ['tt0068646', 'The Godfather'],
      ['tt0468569', 'The Dark Knight'], ['tt0071562', 'The Godfather Part II'],
      ['tt0167260', 'The Lord of the Rings: The Return of the King'], ['tt0050083', '12 Angry Men'],
      ['tt0108052', "Schindler's List"], ['tt0120737', 'The Lord of the Rings: The Fellowship of the Ring'],
      ['tt0110912', 'Pulp Fiction'], ['tt0167261', 'The Lord of the Rings: The Two Towers'],
      ['tt0060196', 'The Good, the Bad and the Ugly'], ['tt0109830', 'Forrest Gump']
    ])
  },
  {
    key: 'animation',
    label: 'Animation',
    items: [
      ...picks('movie', [
        ['tt0245429', 'Spirited Away'], ['tt4633694', 'Spider-Man: Into the Spider-Verse'],
        ['tt0910970', 'WALL·E'], ['tt5311514', 'Your Name.'], ['tt0114709', 'Toy Story'],
        ['tt0382932', 'Ratatouille'], ['tt1049413', 'Up']
      ]),
      ...picks('series', [
        ['tt11126994', 'Arcane'], ['tt0417299', 'Avatar: The Last Airbender'],
        ['tt13309742', 'Blue Eye Samurai'], ['tt0213338', 'Cowboy Bebop'],
        ['tt2560140', 'Attack on Titan']
      ])
    ]
  },
  {
    key: 'k-dramas',
    label: 'K-Dramas',
    items: picks('series', [
      ['tt10850932', 'Crash Landing on You'], ['tt24640580', 'Moving'],
      ['tt20869502', 'Extraordinary Attorney Woo'], ['tt6611916', 'Kingdom'],
      ['tt21344706', 'The Glory'], ['tt14819828', 'Business Proposal'],
      ['tt7923710', 'My Mister'], ['tt14518756', 'Hometown Cha-Cha-Cha'],
      ['tt27668559', 'Queen of Tears'], ['tt11769304', 'Hospital Playlist'],
      ['tt17513352', 'Twenty Five Twenty One']
    ])
  }
]

export async function refreshedCollections(signal) {
  const response = await fetch(new URL('./catalogue-snapshot.json', import.meta.url), { signal, credentials: 'omit' })
  if (!response.ok) throw new Error('The catalogue snapshot is unavailable.')
  const data = await response.json()
  if (!Array.isArray(data?.trending) || !Array.isArray(data.latest)) throw new Error('Invalid catalogue snapshot.')
  return [
    { key: 'trending', label: 'Trending This Week', items: data.trending },
    { key: 'latest', label: 'Latest Releases', items: data.latest }
  ].map(row => ({
    ...row,
    items: row.items.flatMap(item => {
      const title = string(item?.title)
      const artwork = image(item?.artwork)
      return imdbId.test(item?.id) && kinds.has(item.kind) && title && artwork
        ? [{ id: item.id, kind: item.kind, title, artwork }] : []
    }).slice(0, 12)
  })).filter(row => row.items.length)
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
