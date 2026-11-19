import { circleWebOrigins } from './playback.js?v=9'

if (circleWebOrigins.includes(location.origin) && !document.querySelector('script[data-screen-room="app"]')) {
  await openScreenRoom()
}

async function openScreenRoom() {
  try {
    const home = new URL('./', import.meta.url)
    const response = await fetch(home, { credentials: 'omit', redirect: 'error', cache: 'no-cache' })
    if (!response.ok) throw new Error('Screen Room is unavailable')
    const shell = new DOMParser().parseFromString(await response.text(), 'text/html')
    const entry = shell.querySelector('script[type="module"][src]')
    const app = new URL(entry.getAttribute('src'), home)
    entry.remove()
    for (const link of shell.querySelectorAll('link[href]')) {
      link.setAttribute('href', new URL(link.getAttribute('href'), home))
    }
    document.documentElement.replaceWith(document.importNode(shell.documentElement, true))
    const script = document.createElement('script')
    script.type = 'module'
    script.dataset.screenRoom = 'app'
    script.src = app.href
    document.head.append(script)
  } catch {
    alert('Screen Room could not load in this tab.')
  }
}
