async page => {
  const base = 'http://127.0.0.1:4195/'
  const url = query => base + '?' + query
  const requests = []
  page.on('request', request => requests.push(request.url()))
  const check = (condition, message) => { if (!condition) throw new Error(message) }

  await page.setViewportSize({ width: 390, height: 620 })
  await page.goto(url('kind=movie&country=KR&genre=Thriller&page=25'))
  const country = page.getByLabel('Country', { exact: true })
  const genre = page.getByLabel('Genre', { exact: true })
  const cards = page.locator('.movie-grid .title-card')
  const pagination = page.getByRole('navigation', { name: 'Results pages' })
  await cards.first().waitFor()
  check(await country.inputValue() === 'KR' && await genre.inputValue() === 'Thriller', 'The URL restores both filters')
  check(await pagination.getByText(/^Page 25 of /).isVisible(), 'A deep results page is available')
  check(await page.locator('.featured, .shelf').count() === 0, 'Movies has only its browsing grid')
  const poster = cards.first().locator('.poster')
  const box = await poster.boundingBox()
  await poster.locator('img').evaluate(img => img.decode().catch(() => {}))
  const loaded = await poster.boundingBox()
  check(Math.abs(box.width / box.height - 2 / 3) < 0.01 && box.height === loaded.height, 'Artwork keeps the poster footprint')
  const selects = await Promise.all([country.boundingBox(), genre.boundingBox()])
  check(selects.every(control => control.height >= 44) && selects[0].y === selects[1].y, 'Mobile selectors are easy to reach')
  check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'Movies fits on mobile')

  await genre.selectOption('Action')
  await pagination.getByText(/^Page 1 of /).waitFor()
  check(await country.inputValue() === 'KR' && !new URL(page.url()).searchParams.has('page'), 'Changing one selector resets the page')
  await pagination.getByRole('link', { name: 'Next' }).click()
  await pagination.getByText(/^Page 2 of /).waitFor()
  const movie = cards.nth(8)
  await movie.scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  check(scroll > 0, 'The title is below the fold')
  const movieTitle = await movie.locator('h2').textContent()
  await movie.click()
  await page.locator('.title-layout h1').waitFor()
  await page.goBack()
  await pagination.getByText(/^Page 2 of /).waitFor()
  check(await country.inputValue() === 'KR' && await genre.inputValue() === 'Action', 'Back restores both selectors')
  check(await movie.locator('h2').textContent() === movieTitle, 'Back restores the same movie page')
  await page.waitForFunction(y => Math.abs(scrollY - y) < 8, scroll)

  await page.setViewportSize({ width: 320, height: 620 })
  check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'Movies fits a narrow phone')
  await page.setViewportSize({ width: 1152, height: 768 })
  await page.goto(url('kind=movie'))
  await cards.first().waitFor()
  check(await page.locator('.movie-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length) === 5,
    'Desktop uses the wider poster grid')

  const parser = await page.request.get(base + 'movies-data/index.json')
  const manifest = await parser.json()
  await page.route('**/movies-data/index.json', route => route.fulfill({ json: {
    ...manifest, counts: { ...manifest.counts, 'KR/thriller': 0 }
  } }))
  await page.goto(url('kind=movie&country=KR&genre=Thriller'))
  await page.getByRole('heading', { name: 'No movies found' }).waitFor()
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await cards.first().waitFor()
  check(await country.inputValue() === '' && await genre.inputValue() === '', 'Clear filters returns to all Movies')
  check(!requests.some(request => /circleftp|\/api\/play\?/.test(request)), 'Browsing Movies and details sends no Circle request')
  return 'Movies filters, deep pagination, poster dimensions, Back restoration, and empty state passed'
}
