import { writeFile, rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { imdbId } from '../public/catalogue.js'

const regions = ['BD', 'IN', 'US']
const rowSize = 12
const batchSize = 8

function dateOnly(value) {
  const date = typeof value === 'string' ? value.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(+parsed) && parsed.toISOString().startsWith(date) ? date : ''
}

export function digitalRelease(releases, today) {
  for (const region of regions) {
    const dates = releases.find(entry => entry.iso_3166_1 === region)?.release_dates
    const releasedOn = (dates ?? []).filter(entry => entry.type === 4)
      .map(entry => dateOnly(entry.release_date)).filter(date => date && date <= today).sort()[0]
    if (releasedOn) return { region, releasedOn }
  }
  return null
}

function rows(payload, source) {
  if (!Array.isArray(payload?.results)) throw new Error(source + ' returned an invalid list.')
  return payload.results
}

function isPoster(value) {
  return typeof value === 'string' && /^\/[\w-]+\.(jpg|jpeg|png|webp)$/i.test(value)
}

function entry(candidate, id, kind) {
  const label = candidate.title || candidate.name
  if (!imdbId.test(id ?? '') || typeof label !== 'string' || !label.trim() || !isPoster(candidate.poster_path)) return null
  return {
    id,
    kind,
    title: label.trim().slice(0, 280),
    artwork: 'https://image.tmdb.org/t/p/w342' + candidate.poster_path
  }
}

function unique(entries) {
  const seen = new Set()
  return entries.filter(item => {
    if (!item || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

async function inBatches(items, transform) {
  const results = []
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(transform)))
  }
  return results
}

export async function buildSnapshot(request, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const from = new Date(+now - 28 * 86_400_000).toISOString().slice(0, 10)
  const movieDetails = new Map()

  function movie(id) {
    if (!movieDetails.has(id)) {
      movieDetails.set(id, request('/movie/' + id, { append_to_response: 'external_ids,release_dates' }))
    }
    return movieDetails.get(id)
  }

  function usable(candidate) {
    return Number.isSafeInteger(candidate?.id) && candidate.id > 0 && candidate.adult !== true && isPoster(candidate.poster_path)
  }

  async function weekly() {
    const entries = []
    for (const page of [1, 2]) {
      const feed = await request('/trending/all/week', { page, language: 'en-US' })
      const candidates = rows(feed, 'TMDB weekly trending').filter(item =>
        usable(item) && ['movie', 'tv'].includes(item.media_type))
      entries.push(...await inBatches(candidates, async candidate => {
        if (candidate.media_type === 'movie') {
          const details = await movie(candidate.id)
          return entry(candidate, details.external_ids?.imdb_id ?? details.imdb_id, 'movie')
        }
        const ids = await request('/tv/' + candidate.id + '/external_ids')
        return entry(candidate, ids.imdb_id, 'series')
      }))
      if (unique(entries).length >= rowSize || page >= feed.total_pages) break
    }
    return unique(entries).slice(0, rowSize)
  }

  async function regional(region) {
    const candidates = []
    const query = {
      region,
      with_release_type: 4,
      'release_date.gte': from,
      'release_date.lte': today,
      include_adult: false,
      language: 'en-US'
    }
    for (let page = 1; ; page++) {
      const feed = await request('/discover/movie', { ...query, page })
      const results = rows(feed, 'TMDB digital releases')
      candidates.push(...results.filter(usable))
      if (!results.length || page >= (feed.total_pages ?? 1)) return candidates
    }
  }

  const trending = await weekly()
  const trendIds = new Set(trending.map(item => item.id))
  const markets = await Promise.all(regions.map(regional))
  const candidates = [...new Map(markets.flat().map(candidate => [candidate.id, candidate])).values()]
  const releases = await inBatches(candidates, async candidate => {
    const details = await movie(candidate.id)
    const release = digitalRelease(rows(details.release_dates, 'TMDB release dates'), today)
    const item = entry(candidate, details.external_ids?.imdb_id ?? details.imdb_id, 'movie')
    return item && release && release.releasedOn >= from ? { ...item, ...release } : null
  })
  const latest = unique(releases).sort((a, b) =>
    b.releasedOn.localeCompare(a.releasedOn) || Number(trendIds.has(a.id)) - Number(trendIds.has(b.id))
  ).slice(0, rowSize)
  if (!trending.length || !latest.length) throw new Error('TMDB did not return usable entries for both rows.')
  return { generatedAt: now.toISOString(), trending, latest }
}

export async function refreshSnapshot(path, request, now) {
  const snapshot = await buildSnapshot(request, now)
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify(snapshot) + '\n')
  await rename(temporary, path)
}

if (import.meta.main) {
  try {
    const token = process.env.TMDB_READ_TOKEN?.trim()
    if (!token) throw new Error('Set the TMDB_READ_TOKEN Actions secret to enable refresh.')
    const output = process.argv[2]
    if (!output) throw new Error('Pass the path of the catalogue snapshot.')
    await refreshSnapshot(output, async (path, params) => {
      const url = new URL('https://api.themoviedb.org/3' + path)
      url.search = new URLSearchParams(params)
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000)
        })
        if (response.ok) return response.json()
        if (response.status !== 429 || attempt >= 2) {
          throw new Error('TMDB returned HTTP ' + response.status + ' for ' + path + '.')
        }
        await response.body?.cancel()
        const seconds = Number(response.headers.get('retry-after')) || (attempt + 1) * 2
        await delay(Math.min(30, Math.max(1, seconds)) * 1000)
      }
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
