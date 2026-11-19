import { writeFile, rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { featured, imdbId, popularCandidates, releaseDay } from '../public/catalogue.js'

const regions = ['BD', 'IN', 'US']
const rowSize = 12
const batchSize = 8
const publicReleaseTypes = new Map([[3, 'theatrical'], [4, 'digital']])

function publicReleaseDates(market, today) {
  return (market?.release_dates ?? []).flatMap(entry => {
    const type = publicReleaseTypes.get(entry.type)
    const date = releaseDay(entry.release_date)
    return type && date && date <= today ? [{ type, date }] : []
  })
}

export function latestRelease(releases, today) {
  for (const region of regions) {
    const market = releases.find(entry => entry.iso_3166_1 === region)
    const dates = publicReleaseDates(market, today).sort((a, b) => a.date.localeCompare(b.date))
    const theatrical = dates.find(entry => entry.type === 'theatrical')
    const digital = dates.find(entry => entry.type === 'digital')
    // Keep a first digital debut after theatrical opening while ignoring later re-releases.
    const chosen = digital && (!theatrical || digital.date >= theatrical.date) ? digital : theatrical
    if (chosen) return { region, releasedOn: chosen.date, releaseType: chosen.type }
  }
  return null
}

export function hasReleasedEpisode(details, today) {
  const episode = details?.last_episode_to_air
  const airDate = releaseDay(episode?.air_date)
  return episode?.season_number >= 1 && episode.episode_number >= 1 && episode.episode_type !== 'special' &&
    Boolean(airDate && airDate <= today)
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

export async function buildSnapshot(request, now = new Date(), readPopular = popularCandidates) {
  const today = now.toISOString().slice(0, 10)
  const from = new Date(+now - 28 * 86_400_000).toISOString().slice(0, 10)
  const movieDetails = new Map()
  const seriesDetails = new Map()

  function movie(id) {
    if (!movieDetails.has(id)) {
      movieDetails.set(id, request('/movie/' + id, { append_to_response: 'external_ids,release_dates' }))
    }
    return movieDetails.get(id)
  }

  function series(id) {
    if (!seriesDetails.has(id)) {
      seriesDetails.set(id, request('/tv/' + id, { append_to_response: 'external_ids' }))
    }
    return seriesDetails.get(id)
  }

  async function released(kind, id) {
    const details = await (kind === 'movie' ? movie(id) : series(id))
    const available = kind === 'movie'
      ? rows(details.release_dates, 'TMDB release dates').some(market => publicReleaseDates(market, today).length)
      : hasReleasedEpisode(details, today)
    return available ? details.external_ids?.imdb_id ?? details.imdb_id : null
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
        const kind = candidate.media_type === 'movie' ? 'movie' : 'series'
        return entry(candidate, await released(kind, candidate.id), kind)
      }))
      if (unique(entries).length >= rowSize || page >= feed.total_pages) break
    }
    return unique(entries).slice(0, rowSize)
  }

  async function regional(region, releaseType) {
    const candidates = []
    const query = {
      region,
      with_release_type: releaseType,
      'release_date.gte': from,
      'release_date.lte': today,
      include_adult: false,
      language: 'en-US'
    }
    for (let page = 1; ; page++) {
      const feed = await request('/discover/movie', { ...query, page })
      const results = rows(feed, 'TMDB regional releases')
      candidates.push(...results.filter(usable))
      if (!results.length || page >= (feed.total_pages ?? 1)) return candidates
    }
  }

  async function popular(kind) {
    const candidates = unique(await readPopular(kind, AbortSignal.timeout(15_000)))
      .filter(item => item.artwork && !featured.some(pick => pick.id === item.id))
    const selected = []
    for (let index = 0; index < candidates.length && selected.length < 18; index += batchSize) {
      const checked = await Promise.all(candidates.slice(index, index + batchSize).map(async item => {
        const matches = await request('/find/' + item.id, { external_source: 'imdb_id' })
        const result = (kind === 'movie' ? matches.movie_results : matches.tv_results)?.[0]
        if (!Number.isSafeInteger(result?.id) || result.id < 1 || result.adult === true) return null
        if (await released(kind, result.id) !== item.id) return null
        return { id: item.id, kind, title: item.title, artwork: item.artwork }
      }))
      selected.push(...checked.filter(Boolean))
    }
    return selected.slice(0, 18)
  }

  const trending = await weekly()
  const trendIds = new Set(trending.map(item => item.id))
  const popularMovies = await popular('movie')
  const popularSeries = await popular('series')
  const markets = await Promise.all(regions.flatMap(region =>
    [...publicReleaseTypes.keys()].map(type => regional(region, type))))
  const candidates = [...new Map(markets.flat().map(candidate => [candidate.id, candidate])).values()]
  const releases = await inBatches(candidates, async candidate => {
    const details = await movie(candidate.id)
    const release = latestRelease(rows(details.release_dates, 'TMDB release dates'), today)
    const item = entry(candidate, details.external_ids?.imdb_id ?? details.imdb_id, 'movie')
    return item && release && release.releasedOn >= from ? { ...item, ...release } : null
  })
  const latest = unique(releases).sort((a, b) =>
    b.releasedOn.localeCompare(a.releasedOn) || Number(trendIds.has(a.id)) - Number(trendIds.has(b.id))
  ).slice(0, rowSize)
  if (![trending, latest, popularMovies, popularSeries].every(items => items.length)) {
    throw new Error('The refresh did not confirm releases for every catalogue row.')
  }
  return { version: 2, generatedAt: now.toISOString(), popularMovies, popularSeries, trending, latest }
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
