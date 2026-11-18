import { bridgeFetch, defaultBridge, pagesOrigin, parseBridge } from './connection.js'

const main = document.querySelector('main')
const hosted = location.origin === pagesOrigin
const storageKey = 'screen-room-bridge'
let bridge = null
if (hosted) {
  try { bridge = parseBridge(localStorage.getItem(storageKey) ?? '') } catch {}
}
const categories = [
  ['', 'All titles'], ['6', 'English movies'], ['2', 'Hindi movies'],
  ['4', 'South Indian movies'], ['3', 'South Indian dubbed'], ['8', 'Foreign movies'],
  ['1', 'Animation'], ['9', 'English & foreign series'], ['5', 'Hindi series'],
  ['22', 'Dubbed series'], ['21', 'Anime'], ['85', 'Documentaries']
]
let navigation
const titleCache = new Map()
const catalogueCache = new Map()
const scrollPositions = new Map()
let currentRoute = readRoute()
history.scrollRestoration = 'manual'
for (const link of document.querySelectorAll('header [data-route]')) {
  link.setAttribute('href', routeTarget(link.getAttribute('href')))
}
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault()
  main.focus()
})
const searchIcon = '<span class="search-icon" aria-hidden="true"></span>'
const playIcon = '<span class="play-icon" aria-hidden="true"></span>'
const glyphs = {
  pause: '<path d="M9 5v14m6-14v14"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4zm12 0a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9H4zm12 1 5 5m0-5-5 5"/>',
  full: '<path d="M9 5H5v4m10-4h4v4M5 15v4h4m6 0h4v-4"/>',
  expand: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m14 6-6 6 6 6"/>'
}

function icon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    glyphs[name] + '</svg>'
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]))
}

function readRoute() {
  if (!hosted) return location.pathname + location.search
  return location.hash.startsWith('#/') && !location.hash.startsWith('#//') ? location.hash.slice(1) : '/'
}

function routeTarget(path) {
  return hosted ? '#' + path : path
}

function resource(path) {
  return hosted ? new URL(path, bridge).href : path
}

function routeLabel(title) {
  document.title = title ? title + ' · Screen Room' : 'Screen Room'
}

function paint(html, signal) {
  if (!signal.aborted) main.innerHTML = html
}

async function getData(path, signal) {
  let response
  try {
    response = hosted ? await bridgeFetch(bridge, path, signal) : await fetch(path, { signal })
  } catch (error) {
    if (hosted && !signal.aborted) throw new Error('Start the Screen Room helper and allow local network access in Chrome.')
    throw error
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Try again in a moment.')
  return data
}

function metadata(item) {
  return [item.kind === 'series' ? 'Series' : 'Movie', item.year, item.duration, item.quality]
    .filter(Boolean).map(value => '<span>' + escape(value) + '</span>').join('')
}

function artwork(item, eager = false) {
  const fallback = '<span class="poster-fallback" aria-hidden="true">' + escape(item.title) + '</span>'
  return fallback + (item.artwork
    ? '<img src="' + escape(resource('/art/' + item.artwork)) + '" alt="" ' +
      (hosted ? 'crossorigin="anonymous" ' : '') + (eager ? '' : 'loading="lazy" ') + 'decoding="async">'
    : '')
}

main.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

function card(item, index) {
  return '<li><a class="title-card" data-route href="' + escape(routeTarget('/title/' + item.id)) + '">' +
    '<div class="poster">' + artwork(item, index < 6) + '</div>' +
    '<h2>' + escape(item.title) + '</h2><span class="meta">' + metadata(item) + '</span>' +
    '</a></li>'
}

function linkToPage(url, page) {
  const params = new URLSearchParams(url.search)
  if (page > 1) params.set('page', page)
  else params.delete('page')
  return url.pathname + (params.size ? '?' + params : '')
}

function pageLinks(url, page, next) {
  if (page <= 1 && !next) return ''
  return '<nav class="pages" aria-label="Results pages">' +
    (page > 1 ? '<a class="button quiet" data-route href="' + escape(routeTarget(linkToPage(url, page - 1))) + '">' + icon('back') + 'Previous</a>' : '<span></span>') +
    '<span>Page ' + page + '</span>' +
    (next ? '<a class="button quiet" data-route href="' + escape(routeTarget(linkToPage(url, page + 1))) + '">Next' + icon('expand') + '</a>' : '<span></span>') +
    '</nav>'
}

function message(title, detail, action = '') {
  return '<section class="message"><h2>' + escape(title) + '</h2><p>' + escape(detail) + '</p>' + action + '</section>'
}

function retryButtons() {
  return '<div class="message-actions"><button class="button quiet" type="button" data-retry>Try again</button>' +
    (hosted ? '<button class="button quiet" type="button" data-change-connection>Change connection</button>' : '') +
    '</div>'
}

function connectionForm(signal) {
  routeLabel('Connect')
  paint('<section class="connection"><h1>Connect to Circle</h1>' +
    '<p>Start the Screen Room helper on your BDIX network, then connect here.</p>' +
    '<form class="bridge-form"><label for="bridge-address">Helper address</label>' +
    '<div class="bridge-row"><input id="bridge-address" name="address" value="' +
    escape(defaultBridge) + '" maxlength="140" spellcheck="false" required>' +
    '<button class="button primary" type="submit">Connect</button></div>' +
    '<p id="bridge-status" role="status"></p></form>' +
    '<a class="help-link" href="https://github.com/youroi/screen-room#connect-the-hosted-app">Helper setup</a></section>', signal)
}

function rowsHeader(searching, query, chosen) {
  if (searching) {
    return '<div class="section-head"><h1>Search</h1></div>' +
      '<form class="search-form" action="/search" role="search">' + searchIcon +
      '<input name="q" type="search" aria-label="Search movies and series" maxlength="100" placeholder="Search movies and series" value="' +
      escape(query) + '"><button class="button primary" type="submit">Search</button></form>'
  }
  return '<div class="section-head"><h1>Browse</h1><label class="category">' +
    '<span class="sr-only">Category</span><select name="category">' +
    categories.map(([value, name]) => '<option value="' + value + '"' +
      (value === chosen ? ' selected' : '') + '>' + escape(name) + '</option>').join('') +
    '</select></label></div>'
}

async function list(url, signal) {
  const searching = url.pathname === '/search'
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const chosen = categories.some(([id]) => id === url.searchParams.get('category')) ? url.searchParams.get('category') : ''
  const page = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('page'), 10) || 1))
  routeLabel(searching ? 'Search' : 'Browse')
  const heading = rowsHeader(searching, query, chosen)
  if (searching && !query) {
    paint(heading, signal)
    return
  }
  const params = new URLSearchParams({ page })
  if (query) params.set('q', query)
  if (!searching && chosen) params.set('category', chosen)
  const skeleton = '<p role="status" class="sr-only">Loading titles</p><ul class="grid skeleton" aria-hidden="true">' +
    '<li><div class="poster"></div></li>'.repeat(6) + '</ul>'
  const endpoint = '/api/catalog?' + params
  const cached = catalogueCache.get(endpoint)
  const saved = cached?.expires > Date.now()
  paint(heading + '<div id="list-body">' + (saved ? '' : skeleton) + '</div>', signal)
  try {
    const data = saved ? cached.data : await getData(endpoint, signal)
    if (signal.aborted) return
    if (!saved) {
      if (catalogueCache.size >= 16) catalogueCache.delete(catalogueCache.keys().next().value)
      catalogueCache.set(endpoint, { data, expires: Date.now() + 90_000 })
    }
    const listBody = main.querySelector('#list-body')
    listBody.innerHTML = data.items.length
      ? '<ul class="grid">' + data.items.map(card).join('') + '</ul>' + pageLinks(url, page, data.hasNext)
      : message('No titles found', searching ? 'Try another title.' : 'Choose another category or check the next page.') +
        pageLinks(url, page, data.hasNext)
  } catch (error) {
    if (!signal.aborted) {
      main.querySelector('#list-body').innerHTML = message('Catalogue unavailable', error.message,
        retryButtons())
    }
  }
}

function titleLink(id) {
  return '<a class="return-link" data-route href="' + escape(routeTarget('/title/' + id)) + '">' + icon('back') + 'Title details</a>'
}

function episodes(item) {
  const first = item.seasons[0]?.episodes[0]
  const button = item.playable || first
    ? '<a class="button primary" data-route href="' + escape(routeTarget('/watch/' + item.id +
      (first ? '?episode=' + encodeURIComponent(first.key) : ''))) + '">' + playIcon + (first ? 'Play first episode' : 'Play') + '</a>'
    : '<p class="muted">Video unavailable.</p>'
  const seasons = item.seasons.map((season, index) => '<details class="season"' + (index === 0 ? ' open' : '') + '><summary>' +
    escape(season.name) + '</summary><ul>' + season.episodes.map(ep =>
      '<li><a data-route href="' + escape(routeTarget('/watch/' + item.id + '?episode=' + encodeURIComponent(ep.key))) + '">' +
      '<span>' + escape(ep.title) + '</span>' + playIcon + '</a></li>').join('') + '</ul></details>').join('')
  return { button, seasons }
}

function details(item) {
  routeLabel(item.title)
  const { button, seasons } = episodes(item)
  const returnTo = history.state?.returnTo ?? '/'
  return '<a class="return-link" data-route data-restore href="' + escape(routeTarget(returnTo)) + '">' +
    icon('back') + (returnTo.startsWith('/search') ? 'Search results' : 'Browse') + '</a>' +
    '<section class="title-layout"><div class="poster detail-poster">' + artwork(item, true) +
    '</div><div class="title-info"><h1>' + escape(item.title) +
    '</h1><p class="meta">' + metadata(item) + '</p>' +
    (item.description ? '<p class="synopsis">' + escape(item.description) + '</p>' : '') +
    button + '</div></section>' +
    (seasons ? '<section class="episode-list"><h2>Episodes</h2>' + seasons + '</section>' : '')
}

function watch(item, url) {
  const selected = url.searchParams.get('episode')
  const allEpisodes = item.seasons.flatMap(season => season.episodes)
  const episode = allEpisodes.find(ep => ep.key === selected)
  if ((item.kind === 'series' && !episode) || (item.kind === 'movie' && !item.playable)) {
    return titleLink(item.id) + message('Video unavailable', 'Choose a playable video from the title page.')
  }
  const heading = episode ? episode.title : item.title
  routeLabel(heading)
  const next = episode ? allEpisodes[allEpisodes.indexOf(episode) + 1] : null
  return '<div class="watch-head">' + titleLink(item.id) + '<h1>' + escape(heading) + '</h1></div>' +
    '<div class="player" id="player">' +
    '<video id="video" playsinline preload="auto" ' + (hosted ? 'crossorigin="anonymous" ' : '') +
      'src="' + escape(resource('/video/' + item.id + '/' + (episode?.key ?? 'movie'))) + '"></video>' +
    '<button class="player-start" type="button" aria-label="Play video">' + playIcon + '</button>' +
    '<div class="buffering" role="status" hidden><span class="spinner" aria-hidden="true"></span><span class="sr-only">Buffering</span></div>' +
    '<div class="controls"><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Playback position" disabled>' +
    '<div class="controls-bar"><button type="button" id="toggle" aria-label="Play">' + playIcon +
    '</button><span id="time" class="player-time">0:00 / 0:00</span><span class="spacer"></span>' +
    '<button type="button" id="mute" aria-label="Mute">' + icon('volume') + '</button>' +
    '<button type="button" id="fullscreen" aria-label="Fullscreen">' + icon('full') + '</button>' +
    '</div></div></div><p id="video-error" class="muted" role="status" hidden></p>' +
    (next ? '<a class="button quiet next-episode" data-route href="' +
      escape(routeTarget('/watch/' + item.id + '?episode=' + encodeURIComponent(next.key))) +
      '">Next episode' + icon('expand') + '</a>' : '')
}

function bindPlayer(signal, autoplay) {
  const video = main.querySelector('video')
  if (!video) return
  const player = main.querySelector('#player')
  const start = main.querySelector('.player-start')
  const toggle = main.querySelector('#toggle')
  const seek = main.querySelector('#seek')
  const time = main.querySelector('#time')
  const mute = main.querySelector('#mute')
  const error = main.querySelector('#video-error')
  const buffering = main.querySelector('.buffering')
  let bufferTimer
  let scrubbing = false

  function formatTime(value) {
    const seconds = Number.isFinite(value) ? Math.floor(value) : 0
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const part = String(seconds % 60).padStart(2, '0')
    return (hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes) + ':' + part
  }

  function updateTime() {
    const canSeek = Number.isFinite(video.duration) && video.duration > 0
    seek.disabled = !canSeek
    if (!scrubbing) seek.value = canSeek ? video.currentTime / video.duration * 100 : 0
    const target = scrubbing ? Number(seek.value) * video.duration / 100 : video.currentTime
    time.textContent = formatTime(target) + ' / ' + formatTime(video.duration)
  }

  function stopBuffering() {
    clearTimeout(bufferTimer)
    buffering.hidden = true
  }

  function failed() {
    stopBuffering()
    start.hidden = true
    error.textContent = 'This video could not play. The source may be unavailable or the format may be unsupported.'
    error.hidden = false
  }

  function flipPlayback() {
    if (video.paused) {
      error.hidden = true
      video.play().catch(failed)
    } else video.pause()
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else if (player.requestFullscreen) player.requestFullscreen().catch(() => {})
    else video.webkitEnterFullscreen?.()
  }

  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata']) video.addEventListener(event, updateTime, { signal })
  video.addEventListener('waiting', () => {
    clearTimeout(bufferTimer)
    if (!video.paused) bufferTimer = setTimeout(() => { buffering.hidden = false }, 220)
  }, { signal })
  video.addEventListener('playing', stopBuffering, { signal })
  for (const event of ['play', 'pause', 'ended']) {
    video.addEventListener(event, () => {
      toggle.setAttribute('aria-label', video.paused ? 'Play' : 'Pause')
      toggle.innerHTML = video.paused ? playIcon : icon('pause')
      start.hidden = !video.paused || video.currentTime > 0 || Boolean(video.error)
      if (video.paused) stopBuffering()
    }, { signal })
  }
  video.addEventListener('error', failed, { signal })
  signal.addEventListener('abort', () => {
    stopBuffering()
    video.pause()
    video.removeAttribute('src')
    video.load()
  }, { once: true })
  seek.addEventListener('input', () => {
    scrubbing = true
    updateTime()
  })
  seek.addEventListener('change', () => {
    const target = Number(seek.value) * video.duration / 100
    scrubbing = false
    if (Number.isFinite(target)) video.currentTime = target
  })
  video.addEventListener('click', flipPlayback)
  toggle.addEventListener('click', flipPlayback)
  start.addEventListener('click', flipPlayback)
  mute.addEventListener('click', () => { video.muted = !video.muted })
  video.addEventListener('volumechange', () => {
    mute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute')
    mute.innerHTML = icon(video.muted ? 'muted' : 'volume')
  })
  main.querySelector('#fullscreen').addEventListener('click', toggleFullscreen)
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
        event.target.closest?.('a, input, button, select, summary, textarea, [contenteditable]')) return
    if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault()
      flipPlayback()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      if (Number.isFinite(video.duration)) {
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (event.key === 'ArrowRight' ? 10 : -10)))
      }
    } else if (event.key.toLowerCase() === 'm') video.muted = !video.muted
    else if (event.key.toLowerCase() === 'f') toggleFullscreen()
  }, { signal })
  if (autoplay) video.play().catch(error => {
    if (!signal.aborted && error.name !== 'NotAllowedError') failed()
  })
}

async function render(focus = false, autoplay = false) {
  navigation?.abort()
  navigation = new AbortController()
  const { signal } = navigation
  const url = new URL(currentRoute, location.origin)
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === (url.pathname === '/search' ? 'search' : 'browse')) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }

  if (focus) {
    window.scrollTo(0, 0)
    main.focus({ preventScroll: true })
  }

  if (hosted && !bridge) return connectionForm(signal)
  if (url.pathname === '/' || url.pathname === '/search') return list(url, signal)

  const [, mode, id] = url.pathname.split('/')
  if (!['title', 'watch'].includes(mode) || !/^\d{1,12}$/.test(id ?? '')) {
    return paint(message('Page not found', 'Open Browse or Search to find a title.'), signal)
  }
  paint('<p class="route-loading" role="status">Loading title…</p>', signal)
  try {
    const cached = titleCache.get(id)
    const item = cached?.expires > Date.now() ? cached.item : await getData('/api/titles/' + id, signal)
    if (signal.aborted) return
    if (titleCache.size >= 36) titleCache.delete(titleCache.keys().next().value)
    if (item !== cached?.item) titleCache.set(id, { item, expires: Date.now() + 300_000 })
    paint('<div class="route-enter">' + (mode === 'watch' ? watch(item, url) : details(item)) + '</div>', signal)
    if (mode === 'watch') bindPlayer(signal, autoplay)
  } catch (error) {
    if (!signal.aborted) paint(message('Title unavailable', error.message,
      retryButtons()), signal)
  }
}

function go(href) {
  if (href === currentRoute) return
  scrollPositions.set(currentRoute, window.scrollY)
  const route = new URL(currentRoute, location.origin)
  const returnTo = route.pathname === '/' || route.pathname === '/search' ? currentRoute : history.state?.returnTo
  history.pushState({ returnTo }, '', routeTarget(href))
  currentRoute = href
  return render(true, href.startsWith('/watch/'))
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-retry]')) return void render()
  if (event.target.closest('[data-change-connection]')) {
    bridge = null
    catalogueCache.clear()
    titleCache.clear()
    try { localStorage.removeItem(storageKey) } catch {}
    return void render()
  }
  const link = event.target.closest('a[data-route]')
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const href = hosted ? link.hash.slice(1) : link.pathname + link.search
  void go(href)?.then(() => {
    if (currentRoute !== href) return
    if (link.hasAttribute('data-restore')) window.scrollTo(0, scrollPositions.get(href) ?? 0)
    if (href === '/search') main.querySelector('input[name="q"]')?.focus({ preventScroll: true })
  })
})
main.addEventListener('submit', event => {
  if (event.target.matches('.bridge-form')) {
    event.preventDefault()
    void connect(event.target)
    return
  }
  if (!event.target.matches('.search-form')) return
  event.preventDefault()
  const query = new FormData(event.target).get('q').trim()
  go('/search' + (query ? '?' + new URLSearchParams({ q: query }) : ''))
})

async function connect(form) {
  const status = form.querySelector('#bridge-status')
  const button = form.querySelector('button')
  if (button.disabled) return
  const address = parseBridge(new FormData(form).get('address'))
  if (!address) {
    status.textContent = 'Enter localhost or the helper’s Wi-Fi IP address.'
    return
  }

  status.textContent = 'Connecting…'
  button.disabled = true
  try {
    const signal = navigation.signal
    const response = await bridgeFetch(address, '/api/ready', AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
    if (!response.ok || (await response.json()).app !== 'Screen Room') throw new Error('Helper unavailable')
    if (signal.aborted) return
    bridge = address
    try { localStorage.setItem(storageKey, address.origin) } catch {}
    await render(true)
  } catch {
    status.textContent = 'Could not connect. Start the helper, verify its address, then allow local network access.'
    button.disabled = false
  }
}
main.addEventListener('change', event => {
  if (!event.target.matches('select[name="category"]')) return
  go('/' + (event.target.value ? '?category=' + event.target.value : ''))
})
window.addEventListener('popstate', () => {
  scrollPositions.set(currentRoute, window.scrollY)
  const href = readRoute()
  currentRoute = href
  void render(true).then(() => {
    if (currentRoute === href) window.scrollTo(0, scrollPositions.get(href) ?? 0)
  })
})
void render()
