import { writeFile, rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { imdbId, offlineCollections, releaseDay } from '../public/catalogue.js'
import { prioritizeHindi } from '../public/hindi-dubs.js'
import playbackChecks from './featured-playback.json' with { type: 'json' }

const regions = ['BD', 'IN', 'KR', 'JP', 'US']
const origins = ['IN', 'KR', 'JP']
const dayMs = 86_400_000
const rowSize = 30
const batchSize = 8
const animationGenre = 16
const baseQuery = { language: 'en-US' }

function publicReleaseDates(market, today) {
  return (market?.release_dates ?? []).flatMap(entry => {
    const date = releaseDay(entry.release_date)
    return (entry.type === 3 || entry.type === 4) && date && date <= today ? [{ type: entry.type, date }] : []
  })
}

function digitalDates(releases, today, from) {
  return regions.flatMap(region => {
    const market = releases.find(entry => entry.iso_3166_1 === region)
    const date = publicReleaseDates(market, today).filter(entry => entry.type === 4)
      .map(entry => entry.date).sort()[0]
    return date && date >= from ? [{ region, releasedOn: date, releaseType: 'digital' }] : []
  })
}

function hasDigitalProvider(market) {
  return ['flatrate', 'free', 'ads', 'rent', 'buy'].some(type => Array.isArray(market?.[type]) && market[type].length)
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

function usable(candidate) {
  return Number.isSafeInteger(candidate?.id) && candidate.id > 0 && candidate.adult !== true &&
    typeof candidate.poster_path === 'string' && /^\/[\w-]+\.(jpg|jpeg|png|webp)$/i.test(candidate.poster_path)
}

function entry(candidate, details, kind, releasedOn) {
  const id = details.external_ids?.imdb_id ?? details.imdb_id
  const label = candidate.title || candidate.name
  if (!imdbId.test(id ?? '') || typeof label !== 'string' || !label.trim()) return null
  const animation = candidate.genre_ids?.includes(animationGenre) ||
    details.genres?.some(genre => genre.id === animationGenre)
  return {
    id,
    kind,
    title: label.trim().slice(0, 280),
    artwork: 'https://image.tmdb.org/t/p/w342' + candidate.poster_path,
    season: kind === 'series' ? details.last_episode_to_air.season_number : undefined,
    group: animation ? 'animation' : kind,
    debut: releaseDay(kind === 'movie' ? details.release_date : details.first_air_date) || releasedOn,
    popularity: candidate.popularity ?? 0,
    releasedOn
  }
}

function publicEntry({ id, kind, title, artwork, region, releasedOn, releaseType }) {
  return { id, kind, title, artwork, region, releasedOn: releaseType ? releasedOn : undefined, releaseType }
}

function unique(entries, key) {
  const seen = new Set()
  return entries.filter(item => {
    if (!item) return false
    const id = key(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function byPopularity(a, b) {
  return (b.popularity ?? 0) - (a.popularity ?? 0)
}

function blendPopular(global, regional) {
  const result = []
  const marketsShown = new Set()
  while (global.length || regional.some(items => items.length)) {
    result.push(...global.splice(0, 2))
    const available = regional.filter(items => items.length)
    const market = available.sort((a, b) =>
      Number(marketsShown.has(a)) - Number(marketsShown.has(b)) || byPopularity(a[0], b[0]))[0]
    if (market) {
      result.push(market.shift())
      marketsShown.add(market)
    }
  }
  return result
}

export function selectFeatured(candidates, now, checks = playbackChecks) {
  const recent = new Date(+now - 365 * dayMs).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  const verifiedSince = new Date(+now - 14 * dayMs).toISOString().slice(0, 10)
  function verified(item) {
    const check = checks[item.id]
    const date = releaseDay(check?.date)
    return date && date >= verifiedSince && date <= today && check.audio === true && check.seek === true &&
      (item.kind === 'movie' || check.season === item.season) ? 1 : 0
  }

  const ranked = unique(candidates, item => item.id).sort((a, b) =>
    verified(b) - verified(a) || Number((b.debut ?? b.releasedOn) >= recent) - Number((a.debut ?? a.releasedOn) >= recent) ||
    byPopularity(a, b) || b.releasedOn.localeCompare(a.releasedOn))
  const groups = ['movie', 'series', 'animation']
  const selected = []
  for (const group of groups) {
    const item = ranked.find(candidate => candidate.group === group)
    if (item) selected.push(item)
  }
  for (const item of ranked) {
    if (selected.length === 6 || !verified(item)) break
    if (!selected.includes(item)) selected.push(item)
  }
  for (const group of groups) {
    if (selected.length === 6) break
    if (selected.filter(item => item.group === group).length >= 2) continue
    const item = ranked.find(candidate => candidate.group === group && !selected.includes(candidate))
    if (item) selected.push(item)
  }
  return [...selected, ...ranked.filter(item => !selected.includes(item))].slice(0, 6).map(publicEntry)
}

export async function buildSnapshot(request, now = new Date(), checks = playbackChecks) {
  const today = now.toISOString().slice(0, 10)
  const from = new Date(+now - 28 * dayMs).toISOString().slice(0, 10)
  const recentDebut = new Date(+now - 548 * dayMs).toISOString().slice(0, 10)
  const detailsCache = new Map()

  function details(kind, id) {
    const path = (kind === 'movie' ? '/movie/' : '/tv/') + id
    if (!detailsCache.has(path)) {
      detailsCache.set(path, request(path, {
        append_to_response: kind === 'movie' ? 'external_ids,release_dates' : 'external_ids'
      }))
    }
    return detailsCache.get(path)
  }

  function releases(details) {
    return rows(details.release_dates, 'TMDB release dates')
  }

  function firstPublicRelease(info) {
    return releases(info).flatMap(market => publicReleaseDates(market, today)).map(entry => entry.date).sort()[0]
  }

  async function released(kind, candidate) {
    const info = await details(kind, candidate.id)
    if (info.adult === true) return null
    const date = kind === 'movie'
      ? firstPublicRelease(info)
      : hasReleasedEpisode(info, today) && releaseDay(info.last_episode_to_air.air_date)
    return date ? entry(candidate, info, kind, date) : null
  }

  async function collect(candidates, transform, limit) {
    const result = new Map()
    for (let index = 0; index < candidates.length && result.size < limit; index += batchSize) {
      const next = await Promise.all(candidates.slice(index, index + batchSize).map(transform))
      for (const item of next) {
        if (item && !result.has(item.id)) result.set(item.id, item)
      }
    }
    return [...result.values()].slice(0, limit)
  }

  async function feed(path, params, maxPages) {
    const candidates = []
    for (let page = 1; page <= maxPages; page++) {
      const payload = await request(path, { ...baseQuery, ...params, page })
      const results = rows(payload, path)
      candidates.push(...results.filter(usable))
      if (!results.length || page >= (payload.total_pages ?? 1)) break
    }
    return candidates
  }

  function discover(kind, params, maxPages) {
    return feed('/discover/' + (kind === 'movie' ? 'movie' : 'tv'), {
      include_adult: false, ...params
    }, maxPages)
  }

  async function weekly() {
    const candidates = (await feed('/trending/all/week', {}, 3))
      .filter(item => ['movie', 'tv'].includes(item.media_type))
    return collect(unique(candidates, item => item.media_type + ':' + item.id),
      candidate => released(candidate.media_type === 'movie' ? 'movie' : 'series', candidate), rowSize)
  }

  async function popular(kind) {
    const endpoint = '/' + (kind === 'movie' ? 'movie' : 'tv') + '/popular'
    const recentSeries = { 'first_air_date.gte': recentDebut, 'first_air_date.lte': today }
    const [global, recent, ...regional] = await Promise.all([
      feed(endpoint, {}, 2),
      kind === 'series' ? discover(kind, { ...recentSeries, 'vote_count.gte': 30 }, 1) : [],
      ...origins.map(country => discover(kind, {
        ...(kind === 'series' ? { ...recentSeries, without_genres: '10764,10767' } : {}),
        with_origin_country: country,
        'vote_count.gte': 30
      }, 1))
    ])
    const candidates = unique(blendPopular([...recent.slice(0, 12), ...global], regional), item => item.id)
    const selected = await collect(candidates, candidate => released(kind, candidate), rowSize)
    return prioritizeHindi(selected)
  }

  async function animation() {
    const query = { with_genres: animationGenre, 'vote_count.gte': 70 }
    const [newMovies, newSeries, movies, series] = await Promise.all([
      discover('movie', { ...query, 'primary_release_date.gte': recentDebut, 'primary_release_date.lte': today }, 1),
      discover('series', { ...query, 'first_air_date.gte': recentDebut, 'first_air_date.lte': today }, 1),
      discover('movie', query, 2),
      discover('series', query, 2)
    ])
    const asMovies = items => items.map(item => ({ ...item, kind: 'movie' }))
    const asSeries = items => items.map(item => ({ ...item, kind: 'series' }))
    const fresh = [...asMovies(newMovies.slice(0, 10)), ...asSeries(newSeries.slice(0, 10))].sort(byPopularity)
    const candidates = blendPopular(fresh, [asMovies(movies), asSeries(series)])
    return prioritizeHindi(await collect(unique(candidates, item => item.kind + ':' + item.id),
      candidate => released(candidate.kind, candidate), rowSize))
  }

  async function dramas() {
    const candidates = await discover('series', {
      with_origin_country: 'KR', with_genres: 18, without_genres: animationGenre, 'vote_count.gte': 40
    }, 2)
    return prioritizeHindi(await collect(unique(candidates, item => item.id),
      candidate => released('series', candidate), rowSize))
  }

  async function curatedShelf(key, additions) {
    const picks = offlineCollections.find(([shelf]) => shelf === key)[1]
    const verified = await collect(picks, async pick => {
      const existing = additions.find(item => item.id === pick.id)
      if (existing) return existing

      const matches = await request('/find/' + pick.id, { external_source: 'imdb_id' })
      const candidate = matches[pick.kind === 'movie' ? 'movie_results' : 'tv_results']?.[0]
      if (!usable(candidate)) return null
      const item = await released(pick.kind, candidate)
      return item?.id === pick.id ? item : null
    }, rowSize)
    return unique([...prioritizeHindi(verified), ...additions], item => item.id).slice(0, rowSize)
  }

  async function latestDigital() {
    const markets = await Promise.all(regions.map(region => discover('movie', {
      region,
      with_release_type: 4,
      'release_date.gte': from,
      'release_date.lte': today
    }, Infinity)))
    const candidates = unique(markets.flat(), item => item.id)
    const latest = await collect(candidates, async candidate => {
      const info = await details('movie', candidate.id)
      const debut = releaseDay(info.release_date)
      if (info.adult === true || (debut && debut < recentDebut) || firstPublicRelease(info) < recentDebut) return null
      const dates = digitalDates(releases(info), today, from)
      const item = entry(candidate, info, 'movie')
      if (!item || !dates.length) return null
      const providers = await request('/movie/' + candidate.id + '/watch/providers')
      if (!providers?.results || typeof providers.results !== 'object' || Array.isArray(providers.results)) {
        throw new Error('TMDB returned invalid digital provider data.')
      }
      const release = dates.find(date => hasDigitalProvider(providers.results[date.region]))
      return release ? { ...item, ...release } : null
    }, Infinity)
    return latest.sort((a, b) => b.releasedOn.localeCompare(a.releasedOn) || byPopularity(a, b)).slice(0, rowSize)
  }

  const trending = await weekly()
  const popularMovies = await popular('movie')
  const popularSeries = await popular('series')
  const animations = await animation()
  const kDramas = await dramas()
  const latest = await latestDigital()
  const featured = selectFeatured([...latest, ...trending, ...popularMovies, ...popularSeries, ...animations, ...kDramas], now, checks)
  const animationShelf = await curatedShelf('animation', animations)
  const dramaShelf = await curatedShelf('k-dramas', kDramas)
  const selections = { popularMovies, popularSeries, trending, latest, animation: animationShelf, kDramas: dramaShelf }
  if (featured.length !== 6 || !Object.values(selections).every(items => items.length)) {
    throw new Error('The refresh did not confirm enough releases for the hero and catalogue rows.')
  }
  const shelves = Object.fromEntries(Object.entries(selections).map(([name, items]) => [name, items.map(publicEntry)]))
  return { version: 4, generatedAt: now.toISOString(), featured, ...shelves }
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
