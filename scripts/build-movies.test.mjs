import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { movieIndex, moviePage, movieSelection, moviesRoute } from '../public/movies.js'

test('Movies groups the full corpus by exact co-production country and genre before pagination', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'still-movies-test-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const source = join(scratch, 'source.csv')
  const scores = join(scratch, 'scores.gz')
  const target = join(scratch, 'movies-data')
  const fixtures = [
    'id,imdb_id,title,release_date,poster_path,production_countries,genres,popularity,adult,status,original_language',
    '1,tt0000010,Co-production,2020-01-02,/poster.jpg,"South Korea, United States of America",Thriller,1,False,Released,en',
    '2,tt0000020,Language only,2020-01-02,/poster.jpg,Japan,Thriller,2500,False,Released,ko',
    '3,tt0000030,Other genre,2020-01-02,/poster.jpg,South Korea,Comedy,3000,False,Released,ko',
    '4,tt0000040,Unreleased,2999-01-02,/poster.jpg,South Korea,Thriller,5000,False,Released,ko'
  ]
  const exported = [{ id: 1, popularity: 1000 }, { id: 2, popularity: 2500 }, { id: 3, popularity: 3000 }]
  for (let rank = 1; rank <= 540; rank++) {
    fixtures.push([rank + 10, 'tt' + (1234000 + rank), 'Movie ' + rank, '2021-01-01', '/poster.jpg',
      'South Korea', 'Thriller', 0, 'False', 'Released', 'en'].join(','))
    exported.push({ id: rank + 10, popularity: 541 - rank })
  }
  await writeFile(source, fixtures.join('\n') + '\n')
  await writeFile(scores, gzipSync(exported.map(row => JSON.stringify(row)).join('\n')))
  execFileSync('python3', [fileURLToPath(new URL('./build-movies.py', import.meta.url)), source, scores, target, '--min-movies', '1'])

  t.mock.method(globalThis, 'fetch', async resource => {
    const path = resource.pathname.split('/movies-data/')[1]
    return new Response(await readFile(join(target, path)))
  })
  const manifest = await movieIndex()
  const selection = { country: 'KR', genre: 'Thriller', page: 1 }
  const first = await moviePage(selection, manifest)
  assert.equal(first.total, 541)
  assert.equal(first.pages, 31)
  assert.equal(first.items[0].title, 'Co-production')
  assert.equal(first.items[1].title, 'Movie 1')
  assert.equal(first.items[0].year, '2020')
  assert.ok(first.items.every(item => !item.title.includes('Language')))
  const later = await moviePage({ ...selection, page: 31 }, manifest)
  assert.deepEqual(later.items.map(item => item.title), ['Movie 540'])
  assert.equal((await moviePage({ ...selection, country: 'US' }, manifest)).total, 1)
  assert.equal((await moviePage({ ...selection, country: 'IN' }, manifest)).total, 0)
  assert.equal((await moviePage({ ...selection, country: '' }, manifest)).items[0].title, 'Language only')
  const href = moviesRoute({ ...selection, page: 31 })
  assert.deepEqual(movieSelection(new URL(href, 'https://example.org').searchParams), { ...selection, page: 31 })
})
