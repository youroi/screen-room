import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { imdbId, releaseDay } from '../public/catalogue.js'

const startYear = 2024
const startMonth = 11
const dayMs = 86_400_000
const month = (year, index) => new Date(Date.UTC(year, index, 1))
const day = date => date.toISOString().slice(0, 10)

async function readPrevious(path) {
  if (!path) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function lookup(token) {
  let nextRequest = 0
  return async function request(path, params) {
    const url = new URL('https://api.themoviedb.org/3' + path)
    url.search = new URLSearchParams(params)
    for (let attempt = 0; ; attempt++) {
      const now = Date.now()
      const wait = Math.max(0, nextRequest - now)
      nextRequest = now + wait + 38
      if (wait) await delay(wait)

      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) return response.json()
      await response.body?.cancel()
      if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
        const seconds = Number(response.headers.get('retry-after')) || attempt + 1
        await delay(Math.min(30, Math.max(1, seconds)) * 1000)
      } else throw new Error('TMDB returned HTTP ' + response.status + ' for ' + path)
    }
  }
}

async function discover(request, from, through, minimumVotes) {
  const queries = {
    language: 'en-US', include_adult: 'false', 'primary_release_date.gte': from, 'primary_release_date.lte': through,
    with_release_type: '3|4', sort_by: 'primary_release_date.asc'
  }
  if (minimumVotes) queries['vote_count.gte'] = minimumVotes
  const first = await request('/discover/movie', { ...queries, page: 1 })
  if (!Array.isArray(first.results) || !Number.isSafeInteger(first.total_pages)) {
    throw new Error('TMDB returned invalid movie search results.')
  }
  if (first.total_pages > 500) {
    const begin = Date.parse(from)
    const end = Date.parse(through)
    if (begin === end) throw new Error('TMDB cannot paginate this release day.')
    const middle = begin + Math.floor((end - begin) / dayMs / 2) * dayMs
    return [
      ...await discover(request, from, day(new Date(middle)), minimumVotes),
      ...await discover(request, day(new Date(middle + dayMs)), through, minimumVotes)
    ]
  }
  const candidates = [...first.results]
  for (let page = 2; page <= first.total_pages; page += 12) {
    const pages = await Promise.all(Array.from({ length: Math.min(12, first.total_pages - page + 1) }, (_, index) =>
      request('/discover/movie', { ...queries, page: page + index })))
    for (const next of pages) candidates.push(...next.results)
  }
  return candidates.map(item => item.id).filter(id => Number.isSafeInteger(id) && id > 0)
}

export async function refreshMovies(request, previous, now) {
  const today = day(now)
  const start = month(startYear, startMonth)
  const latestMonth = month(now.getUTCFullYear(), now.getUTCMonth())
  let cursor = previous?.historyFrom ? new Date(previous.historyFrom + 'T00:00:00Z') : latestMonth
  const windowDays = previous ? 14 : 35
  const ids = new Set(await discover(request, day(new Date(+now - windowDays * dayMs)), today, 0))

  if (!previous) {
    // Seed widely covered releases while the full, vote-independent backfill catches up.
    const seed = await discover(request, day(start), today, 5)
    for (const id of seed) ids.add(id)
  } else if (cursor > start) {
    const from = new Date(Math.max(+start, +month(cursor.getUTCFullYear(), cursor.getUTCMonth() - 2)))
    const historical = await discover(request, day(from), day(new Date(+cursor - dayMs)), 0)
    for (const id of historical) ids.add(id)
    cursor = from
  }

  const movies = new Map((previous?.items ?? []).map(item => [item.id, item]))
  const candidates = [...ids]
  for (let offset = 0; offset < candidates.length; offset += 32) {
    const page = await Promise.all(candidates.slice(offset, offset + 32).map(id => request('/movie/' + id, { language: 'en-US' })))
    for (const movie of page) {
      const { id, imdb_id: imdb, title, release_date: released, poster_path: poster, popularity } = movie
      if (movie.adult || movie.video || movie.status !== 'Released' || !imdbId.test(imdb ?? '') ||
          !releaseDay(released) || released > today || typeof title !== 'string' || !title.trim()) {
        movies.delete(id)
        continue
      }
      if (!Array.isArray(movie.production_countries) || !Array.isArray(movie.genres)) {
        throw new Error('TMDB returned invalid production metadata.')
      }
      movies.set(id, { id, imdb, title, released, poster, popularity,
        countries: movie.production_countries.map(country => country.iso_3166_1),
        genres: movie.genres.map(genre => genre.name) })
    }
  }
  return { historyFrom: day(cursor), items: [...movies.values()] }
}

if (import.meta.main) {
  const token = process.env.TMDB_READ_TOKEN?.trim()
  if (!token) throw new Error('Set the TMDB_READ_TOKEN Actions secret to refresh Movies.')
  const [output, previous] = process.argv.slice(2)
  const data = await refreshMovies(lookup(token), await readPrevious(previous), new Date())
  await writeFile(output, JSON.stringify(data) + '\n')
  console.log('Recent movie metadata:', data.items.length, 'Historical backfill cursor:', data.historyFrom)
}
