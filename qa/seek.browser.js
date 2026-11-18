async page => {
  const fixture = 'http://127.0.0.1:4192'
  const app = 'http://127.0.0.1:4184'
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const trace = async () => (await page.request.get(fixture + '/trace')).json()
  for (const mode of ['normal', 'recover', 'persistent']) {
    await page.goto('about:blank')
    await page.request.get(fixture + '/mode/' + mode)
    await page.clock.install()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(app + '/watch/movie/tt0816692')
    await page.getByRole('button', { name: 'Play video', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 1.1)
    await page.getByRole('slider', { name: 'Playback position' }).evaluate(slider => {
      slider.value = '70'
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })

    if (mode !== 'normal') {
      for (let attempt = 0; attempt < 30 && !(await trace()).failures; attempt++) {
        await page.waitForTimeout(75)
      }
      if (!(await trace()).failures) throw new Error('The media engine did not issue a stalled byte-range request')
      await page.clock.fastForward(8100)
    }
    if (mode === 'persistent') {
      for (let attempt = 0; attempt < 30 && (await trace()).failures < 2; attempt++) {
        await page.waitForTimeout(75)
      }
      if ((await trace()).failures !== 2) throw new Error('The player should automatically retry exactly once')
      await page.clock.fastForward(8100)
      await page.getByRole('heading', { name: 'Seek stalled', exact: true }).waitFor()
      if (await page.locator('.buffering').isVisible()) throw new Error('Spinner remained visible after the deadline')
      await page.getByRole('button', { name: /Resume at/ }).click()
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video.currentTime >= 1 && video.currentTime <= 4 && !video.seeking && !video.paused
      })
    } else {
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video.currentTime > 12 && !video.seeking && !video.paused &&
          document.querySelector('.buffering').hidden
      })
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Playback overflowed on mobile')
  }
  if (errors.length) throw new Error(errors.join('; '))
  return { happySeek: 'passed', realRangeStall: 'reopen recovered', permanentRangeStall: 'bounded and resumed' }
}
