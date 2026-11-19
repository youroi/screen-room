import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSnapshot, hasReleasedEpisode, latestRelease, refreshSnapshot } from './refresh-catalogue.mjs'
import { hasHindiDub, prioritizeHindi } from '../public/hindi-dubs.js'

const now = new Date('2026-11-19T10:23:00Z')
const film = (id, title) => ({ id, title, media_type: 'movie', poster_path: '/poster.jpg' })
const release = (iso_3166_1, ...dates) => ({
  iso_3166_1,
  release_dates: dates.map(([type, date]) => ({ type, release_date: date + 'T00:00:00Z' }))
})

test('regular theatrical and digital releases count and advance screenings do not', () => {
  assert.deepEqual(latestRelease([
    release('BD', [1, '2026-11-16'], [2, '2026-11-18'], [4, '2026-12-25']),
    release('IN', [3, '2026-11-16'], [3, '2026-11-18']),
    release('US', [4, '2026-11-19'])
  ], '2026-11-19'), { region: 'IN', releasedOn: '2026-11-16', releaseType: 'theatrical' })
  assert.equal(latestRelease([
    release('BD', [1, '2026-11-19'], [2, '2026-11-19']),
    release('US', [4, '2026-02-30']),
    release('FR', [4, '2026-11-19'])
  ], '2026-11-19'), null)
  assert.deepEqual(latestRelease([
    release('BD', [3, '2026-09-20'], [4, '2026-11-17']), release('IN', [4, '2026-11-18'])
  ], '2026-11-19'), { region: 'BD', releasedOn: '2026-11-17', releaseType: 'digital' })
  assert.deepEqual(latestRelease([
    release('BD', [3, '2026-11-16'], [4, '2026-11-19'])
  ], '2026-11-19', () => false), { region: 'BD', releasedOn: '2026-11-16', releaseType: 'theatrical' })
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

test('weekly and popular skip upcoming titles while Latest requires a provider for digital dates', async () => {
  const movies = [
    film(1, 'First'), film(2, 'Early preview'), film(3, 'Regular theatrical'),
    film(4, 'Digital debut'), film(5, 'Upcoming'), film(8, 'Unconfirmed digital listing')
  ]
  const series = [{ ...film(6, 'Upcoming series'), media_type: 'tv' }, { ...film(7, 'On air'), media_type: 'tv' }]
  const imdb = id => 'tt000000' + id
  const marketQueries = []
  const requested = []
  const snapshot = await buildSnapshot(async (path, params) => {
    requested.push(path)
    if (path === '/trending/all/week') {
      assert.equal(params.page, 1)
      return { results: [movies[4], series[0], movies[0], movies[1], series[1], movies[0]], total_pages: 1 }
    }
    if (path === '/discover/movie') {
      marketQueries.push(params.region + ':' + params.with_release_type)
      assert.equal(params['release_date.lte'], '2026-11-19')
      if (params.region === 'IN' && params.with_release_type === 4 && params.page === 1) {
        return { results: movies.slice(0, 3), total_pages: 2 }
      }
      return { results: movies.slice(3), total_pages: params.page }
    }
    if (path.startsWith('/find/')) {
      assert.equal(params.external_source, 'imdb_id')
      const id = Number(path.at(-1))
      return { [id === 6 || id === 7 ? 'tv_results' : 'movie_results']: [{ id }] }
    }
    if (path.endsWith('/watch/providers')) {
      const id = Number(path.split('/')[2])
      return { results: { [id === 8 ? 'US' : 'IN']: { rent: [{ provider_id: 1 }] } } }
    }
    const id = Number(path.split('/').at(-1))
    if (path.startsWith('/tv/')) {
      assert.equal(params.append_to_response, 'external_ids')
      return { external_ids: { imdb_id: imdb(id) }, ...tvEpisode(id === 6 ? '2026-11-20' : '2026-11-18') }
    }
    assert.equal(params.append_to_response, 'external_ids,release_dates')
    const dates = {
      1: [4, '2026-11-19'],
      2: [1, '2026-11-19'],
      3: [3, '2026-11-19'],
      4: [4, '2026-11-17'],
      5: [3, '2026-12-18'],
      8: [4, '2026-11-19']
    }
    return { imdb_id: imdb(id), release_dates: { results: [release('IN', dates[id])] } }
  }, now, async kind => (kind === 'movie' ? movies : series).map(item => ({
    id: imdb(item.id), title: item.title, kind, artwork: 'https://image.tmdb.org/t/p/w342/poster.jpg'
  })))
  assert.equal(snapshot.version, 3)
  assert.deepEqual(snapshot.trending.map(item => item.title), ['First', 'On air'])
  assert.deepEqual(snapshot.popularMovies.map(item => item.title), ['First', 'Regular theatrical', 'Digital debut', 'Unconfirmed digital listing'])
  assert.deepEqual(snapshot.popularSeries.map(item => item.title), ['On air'])
  assert.deepEqual(snapshot.latest.map(item => item.title), ['Regular theatrical', 'First', 'Digital debut'])
  assert.deepEqual([...new Set(marketQueries)], ['BD:3', 'BD:4', 'IN:3', 'IN:4', 'US:3', 'US:4'])
  assert.equal(requested.filter(path => path === '/movie/1').length, 1)
  assert.equal(snapshot.latest[0].releaseType, 'theatrical')
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
  const dubbedShow = { kind: 'series', id: 'tt2560140' }
  const dubbedFilm = { kind: 'movie', id: 'tt4154796' }
  const other = { kind: 'series', id: 'tt0000007' }
  const another = { kind: 'movie', id: 'tt0000008' }
  assert.equal(hasHindiDub(dubbedShow, 1), true)
  assert.equal(hasHindiDub(dubbedShow, 2), false)
  assert.deepEqual(prioritizeHindi([other, dubbedShow, another, dubbedFilm]), [dubbedShow, dubbedFilm, other, another])
})
