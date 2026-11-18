async page => {
  const fixture = 'http://127.0.0.1:4192'
  const app = 'http://127.0.0.1:4184'
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const trace = async () => (await page.request.get(fixture + '/trace')).json()
  const waitForTrace = async predicate => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await trace()
      if (predicate(state)) return state
      await page.waitForTimeout(75)
    }
    throw new Error('Unexpected media requests: ' + JSON.stringify(await trace()))
  }
  for (const mode of ['normal', 'ignore-range', 'recover', 'persistent']) {
    await page.goto('about:blank')
    await page.request.get(fixture + '/mode/' + mode)
    await page.clock.install()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(app + '/watch/movie/tt0816692')
    await page.getByRole('button', { name: 'Play video', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 1.1)
    const jump = value => page.getByRole('slider', { name: 'Playback position' }).evaluate((slider, value) => {
      slider.value = value
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
    await jump('70')

    if (mode === 'ignore-range') {
      await page.getByText('Circle sent a full-file response.', { exact: false }).waitFor()
      const state = await waitForTrace(state => state.cancelled)
      if (state.failures || state.trace.filter(start => start === 1).length !== 1) throw new Error('Unexpected seek after HTTP 200')
      await page.getByText('Playback details', { exact: true }).click()
      if (!(await page.locator('.playback-debug pre').innerText()).includes('Range bytes=1-1: HTTP 200')) {
        throw new Error('The report did not include the full-file response')
      }
      await jump('4')
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video.currentTime < 1 && !video.seeking && !video.paused
      })
      if ((await trace()).trace.filter(start => start === 1).length !== 1) throw new Error('Buffered seek issued a probe')
    }
    if (mode === 'persistent' || mode === 'recover') {
      await waitForTrace(state => state.failures === 1)
      await page.clock.fastForward(8100)
      await page.getByRole('heading', { name: 'Seek stalled', exact: true }).waitFor()
      const halted = await waitForTrace(state => state.cancelled)
      await page.clock.fastForward(8100)
      if ((await trace()).trace.length !== halted.trace.length) throw new Error('The player restarted a stalled download')
      if (await page.locator('.buffering').isVisible()) throw new Error('Spinner remained visible after the deadline')
      await page.getByText('Playback details', { exact: true }).click()
      if (!(await page.locator('.playback-debug pre').innerText()).includes('Range bytes=1-1: HTTP 206')) {
        throw new Error('The report did not include the partial-content response')
      }
    }
    if (mode === 'persistent') {
      await page.getByRole('button', { name: /Resume at/ }).click()
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video.currentTime >= 1 && video.currentTime <= 4 && !video.seeking && !video.paused
      })
    } else if (mode !== 'ignore-range') {
      if (mode === 'recover') await page.getByRole('button', { name: 'Retry seek' }).click()
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video.currentTime > 12 && !video.seeking && !video.paused &&
          document.querySelector('.buffering').hidden
      })
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Playback overflowed on mobile')
  }
  if (errors.length) throw new Error(errors.join('; '))
  return { normal: 'passed', ignoredRange: 'cancelled, buffered seek works', recoverableStall: 'manual retry works', persistentStall: 'cancelled, no automatic retry, resume works' }
}
