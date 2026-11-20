import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSnapshot, hasReleasedEpisode, refreshSnapshot, selectFeatured } from './refresh-catalogue.mjs'
import { hasHindiDub, prioritizeHindi } from '../public/hindi-dubs.js'

const now = new Date('2026-11-19T10:23:00Z')
const film = (id, title) => ({ id, title, media_type: 'movie', poster_path: '/poster.jpg' })
const release = (iso_3166_1, ...dates) => ({
  iso_3166_1,
  release_dates: dates.map(([type, date]) => ({ type, release_date: date + 'T00:00:00Z' }))
})

function tvEpisode(air_date, season_number = 1) {
  return { last_episode_to_air: { air_date, season_number, episode_number: 1 } }
}

test('series require a full released episode', () => {
  assert.equal(hasReleasedEpisode(tvEpisode('2026-11-19'), '2026-11-19'), true)
  assert.equal(hasReleasedEpisode(tvEpisode('2026-11-20'), '2026-11-19'), false)
  assert.equal(hasReleasedEpisode(tvEpisode('2026-11-01', 0), '2026-11-19'), false)
  assert.equal(hasReleasedEpisode({ first_air_date: '2026-11-01' }, '2026-11-19'), false)
})

test('snapshot keeps weekly order, blends regional popularity and requires a confirmed digital debut', async () => {
  const imdb = id => 'tt000000' + id
  const movies = [
    film(1, 'US digital'), film(2, 'Early preview'), film(3, 'Theatrical only'),
    film(4, 'Indian digital'), film(5, 'Upcoming'), film(8, 'Unconfirmed digital listing'),
    { ...film(9, 'Japan animation'), genre_ids: [16] }, film(10, 'Korean digital'), film(11, 'Reissue'), film(14, 'Delayed catalogue addition')
  ]
  const series = [
    { ...film(6, 'Upcoming series'), media_type: 'tv' },
    { ...film(7, 'On air'), media_type: 'tv' },
    { ...film(12, 'K-drama'), media_type: 'tv' },
    { ...film(13, 'Japanese animation series'), media_type: 'tv', genre_ids: [16] }
  ]
  const ids = entries => entries.map(item => item.id)
  const movie = id => movies.find(item => item.id === id)
  const show = id => series.find(item => item.id === id)
  const marketQueries = []
  const requested = []
  const snapshot = await buildSnapshot(async (path, params) => {
    requested.push(path)
    let results
    if (path === '/trending/all/week') results = [movie(5), show(6), movie(1), movie(2), show(7), movie(1), movie(4)]
    if (path === '/movie/popular') results = [movie(5), movie(3), movie(1), movie(2), movie(8)]
    if (path === '/tv/popular') results = [show(6), show(7)]
    if (path === '/discover/movie') {
      if (params.region) {
        marketQueries.push(params.region)
        assert.equal(params.with_release_type, 4)
        assert.equal(params['release_date.lte'], '2026-11-19')
        if (params.region === 'US' && params.page === 1) return { results: [movie(8), movie(3), movie(11), movie(14)], total_pages: 2 }
        results = [movie(1), movie(4), movie(10)]
      } else if (params.with_genres === 16) results = [movie(9)]
      else if (params.with_origin_country === 'IN') results = [movie(4)]
      else if (params.with_origin_country === 'KR') results = [movie(10)]
      else results = [movie(9)]
    }
    if (path === '/discover/tv') {
      if (params.with_genres === 16 || params.with_origin_country === 'JP') results = [show(13)]
      else if (params.with_origin_country === 'KR') results = [show(12)]
      else results = []
    }
    if (results) return { results, total_pages: 1 }
    if (path.startsWith('/find/')) {
      assert.equal(params.external_source, 'imdb_id')
      return { tv_results: path.endsWith('tt21209876') ? [film(15, 'Solo Leveling')] : [] }
    }
    const id = Number(path.split('/')[2])
    if (path.endsWith('/watch/providers')) {
      const market = { 1: 'US', 4: 'IN', 8: 'US', 10: 'KR' }[id]
      return { results: { [market]: { rent: [{ provider_id: 1 }] } } }
    }
    if (path.startsWith('/tv/')) {
      assert.equal(params.append_to_response, 'external_ids')
      const externalId = { 12: 'tt26471411', 15: 'tt21209876' }[id] ?? imdb(id)
      return { external_ids: { imdb_id: externalId }, ...tvEpisode(id === 6 ? '2026-11-20' : '2026-11-18') }
    }
    assert.equal(params.append_to_response, 'external_ids,release_dates')
    const dates = {
      1: [release('US', [4, '2026-11-19'])],
      2: [release('BD', [1, '2026-11-19'], [2, '2026-11-19'])],
      3: [release('IN', [3, '2026-11-19'], [4, '2026-12-01'])],
      4: [release('BD', [3, '2026-10-17']), release('IN', [4, '2026-11-17'])],
      5: [release('IN', [3, '2026-12-18'])],
      8: [release('IN', [4, '2026-11-19']), release('US', [4, '2026-02-30'])],
      9: [release('JP', [3, '2026-10-17'])],
      10: [release('KR', [4, '2026-11-18'])],
      11: [release('US', [4, '2025-01-03'], [4, '2026-11-19'])],
      14: [release('KR', [4, '2026-11-19']), release('US', [3, '2019-04-26'])]
    }
    return { imdb_id: imdb(id), release_dates: { results: dates[id] } }
  }, now, {})
  assert.equal(snapshot.version, 4)
  assert.deepEqual(ids(snapshot.trending), [1, 7, 4].map(imdb))
  assert.deepEqual(ids(snapshot.popularMovies), [3, 4, 1, 10, 8, 9].map(imdb))
  assert.deepEqual(ids(snapshot.popularSeries), [imdb(7), 'tt26471411', imdb(13)])
  assert.deepEqual(ids(snapshot.animation), ['tt21209876', imdb(9), imdb(13)])
  assert.deepEqual(ids(snapshot.kDramas), ['tt26471411'])
  assert.deepEqual(ids(snapshot.latest), [1, 10, 4].map(imdb))
  assert.deepEqual([...new Set(marketQueries)], ['BD', 'IN', 'KR', 'JP', 'US'])
  assert.equal(requested.filter(path => path === '/movie/1').length, 1)
  assert.equal(snapshot.featured.length, 6)
  assert.equal(new Set(ids(snapshot.featured)).size, 6)
  assert.ok(snapshot.latest.every(item => item.releaseType === 'digital'))
})

test('featured uses fresh playback evidence and fills all six slots when a group has fewer picks', () => {
  const movie = (id, popularity) => ({ id, kind: 'movie', group: 'movie', popularity, releasedOn: '2026-11-10' })
  const show = { ...movie('show', 90), kind: 'series', group: 'series', season: 2 }
  const anime = { ...movie('anime', 70), group: 'animation' }
  const oldAnime = { ...anime, id: 'old-anime', popularity: 800, debut: '2008-01-01' }
  const candidates = [movie('usual', 90), movie('expired', 60), movie('verified', 20), movie('partial', 10), show, anime, oldAnime]
  const selected = selectFeatured(candidates, now, {
    verified: { date: '2026-11-17', audio: true, seek: true },
    expired: { date: '2026-10-01', audio: true, seek: true },
    partial: { date: '2026-11-18', audio: true, seek: false },
    show: { date: '2026-11-17', audio: true, seek: true, season: 1 }
  })
  assert.deepEqual(selected.map(item => item.id), ['verified', 'show', 'anime', 'usual', 'old-anime', 'expired'])
})

test('a failed refresh leaves the previous snapshot untouched', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'still-refresh-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'catalogue-snapshot.json')
  const previous = '{"trending":[{"id":"tt0000001"}],"latest":[{"id":"tt0000002"}]}\n'
  await writeFile(file, previous)
  await assert.rejects(refreshSnapshot(file, async () => { throw new Error('Upstream failed') }, now), /Upstream failed/)
  assert.equal(await readFile(file, 'utf8'), previous)
})

test('Hindi boosts are stable and only explicitly confirmed seasons are marked', () => {
  const dubbedShow = { kind: 'series', id: 'tt2560140', season: 1 }
  const dubbedFilm = { kind: 'movie', id: 'tt4154796' }
  const other = { kind: 'series', id: 'tt0000007' }
  const another = { kind: 'movie', id: 'tt0000008' }
  assert.equal(hasHindiDub(dubbedShow, 1), true)
  assert.equal(hasHindiDub(dubbedShow, 2), false)
  assert.equal(hasHindiDub(dubbedShow), false)
  assert.deepEqual(prioritizeHindi([other, dubbedShow, another, dubbedFilm]), [dubbedShow, dubbedFilm, other, another])
})
