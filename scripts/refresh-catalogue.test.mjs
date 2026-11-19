import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSnapshot, digitalRelease, refreshSnapshot } from './refresh-catalogue.mjs'
import { hasHindiDub, prioritizeHindi } from '../public/hindi-dubs.js'

const now = new Date('2026-11-19T10:23:00Z')
const film = (id, title) => ({ id, title, media_type: 'movie', poster_path: '/poster.jpg' })
const release = (iso_3166_1, ...dates) => ({
  iso_3166_1,
  release_dates: dates.map(([type, date]) => ({ type, release_date: date + 'T00:00:00Z' }))
})

test('only valid, already released digital dates qualify in the selected market order', () => {
  assert.deepEqual(digitalRelease([
    release('BD', [3, '2026-11-16'], [4, '2026-12-25']),
    release('IN', [4, '2026-11-16'], [4, '2026-11-18']),
    release('US', [4, '2026-11-19'])
  ], '2026-11-19'), { region: 'IN', releasedOn: '2026-11-16' })
  assert.equal(digitalRelease([
    release('BD', [3, '2026-11-19']),
    release('US', [4, '2026-02-30']),
    release('FR', [4, '2026-11-19'])
  ], '2026-11-19'), null)
  assert.deepEqual(digitalRelease([
    release('BD', [4, '2026-11-17']), release('IN', [4, '2026-11-18'])
  ], '2026-11-19'), { region: 'BD', releasedOn: '2026-11-17' })
})

test('weekly rank stays intact and same-day releases prefer a title without weekly overlap', async () => {
  const titles = [film(1, 'First'), film(2, 'Second'), film(3, 'Third'), film(4, 'Fourth')]
  const marketQueries = []
  const requested = []
  const snapshot = await buildSnapshot(async (path, params) => {
    requested.push(path)
    if (path === '/trending/all/week') {
      assert.equal(params.page, 1)
      return { results: [titles[0], { id: 9, media_type: 'person' }, titles[1], titles[0]], total_pages: 1 }
    }
    if (path === '/discover/movie') {
      marketQueries.push(params.region)
      assert.equal(params.with_release_type, 4)
      assert.equal(params['release_date.lte'], '2026-11-19')
      if (params.region === 'IN' && params.page === 1) return { results: titles.slice(1, 3), total_pages: 2 }
      return { results: params.region === 'IN' ? [titles[3]] : titles.slice(0, 3), total_pages: params.page }
    }
    const id = Number(path.split('/').at(-1))
    assert.equal(params.append_to_response, 'external_ids,release_dates')
    return { imdb_id: 'tt000000' + id, release_dates: { results: [
      id === 2
        ? release('BD', [3, '2026-11-19'])
        : release('IN', [4, id === 4 ? '2026-11-17' : '2026-11-19'])
    ] } }
  }, now)
  assert.deepEqual(snapshot.trending.map(item => item.title), ['First', 'Second'])
  assert.deepEqual(snapshot.latest.map(item => item.title), ['Third', 'First', 'Fourth'])
  assert.deepEqual([...new Set(marketQueries)], ['BD', 'IN', 'US'])
  assert.equal(requested.filter(path => path === '/movie/1').length, 1)
  assert.equal(snapshot.latest[0].region, 'IN')
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
