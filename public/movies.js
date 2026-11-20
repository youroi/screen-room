export const movieCountries = [
  ['', 'All countries'], ['US', 'United States'], ['IN', 'India'], ['KR', 'South Korea'], ['JP', 'Japan']
]

export const movieGenres = [
  '', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy',
  'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'TV Movie', 'Thriller', 'War', 'Western'
]

export const moviesPageSize = 18

export function movieSelection(params) {
  const country = params.get('country')
  const genre = params.get('genre') || ''
  const page = Number(params.get('page') || 1)
  return {
    country: movieCountries.some(([code]) => code === country) ? country : '',
    genre: movieGenres.find(name => name.toLowerCase() === genre.toLowerCase()) ?? '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1
  }
}

export function moviesRoute({ country, genre, page = 1 }) {
  const params = new URLSearchParams({ kind: 'movie' })
  if (country) params.set('country', country)
  if (genre) params.set('genre', genre)
  if (page > 1) params.set('page', page)
  return '/?' + params
}

function group({ country, genre }) {
  return (country || 'all') + '/' + (genre.toLowerCase().replaceAll(' ', '-') || 'all')
}

function invalidCatalogue() {
  return new Error('Movies are temporarily unavailable. Try again.')
}

async function readIndex(path, signal, cache) {
  const response = await fetch(new URL('./movies-data/' + path, import.meta.url), {
    credentials: 'omit', signal, cache
  })
  if (!response.ok) throw invalidCatalogue()
  return response.json()
}

export async function movieIndex(signal, cache) {
  const index = await readIndex('index.json', signal, cache)
  if (index?.version !== 1 || !/^\d{8}T\d{6}Z$/.test(index.revision) ||
      !Number.isSafeInteger(index.pagesPerShard) || index.pagesPerShard < 1 || index.pagesPerShard > 24 ||
      !Number.isSafeInteger(index.counts?.['all/all']) || index.counts['all/all'] < 1) throw invalidCatalogue()
  return index
}

export async function moviePage(selection, index, signal, cache) {
  const key = group(selection)
  const total = index.counts[key] ?? 0
  if (!Number.isSafeInteger(total) || total < 0) throw invalidCatalogue()
  const pages = Math.max(1, Math.ceil(total / moviesPageSize))
  const { page } = selection
  if (total === 0 || page > pages) return { items: [], total, pages }

  const shard = Math.floor((page - 1) / index.pagesPerShard)
  const offset = ((page - 1) % index.pagesPerShard) * moviesPageSize
  const payload = await readIndex(key + '/' + shard + '.json?v=' + index.revision, signal, cache)
  if (payload?.revision !== index.revision || !Array.isArray(payload.items)) throw invalidCatalogue()
  const rows = payload.items.slice(offset, offset + moviesPageSize)
  if (rows.length !== Math.min(moviesPageSize, total - (page - 1) * moviesPageSize)) throw invalidCatalogue()

  const items = rows.map(row => {
    if (!Array.isArray(row)) throw invalidCatalogue()
    const [id, title, year, poster] = row
    if (!/^tt\d{5,12}$/.test(id) || typeof title !== 'string' || !title || !/^\d{4}$/.test(year)) {
      throw invalidCatalogue()
    }
    const artwork = /^\/[\w-]+\.(jpg|jpeg|png|webp)$/i.test(poster) ? 'https://image.tmdb.org/t/p/w342' + poster : null
    return { id, title, kind: 'movie', year, artwork }
  })
  return { items, total, pages }
}
