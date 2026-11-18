import { browse, search, title, imdbId, kinds } from './catalogue.js'
import { hostedCircleStream } from './playback.js'

const main = document.querySelector('main')
const hosted = location.protocol === 'https:'
const genres = ['', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
  'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller']
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

function itemRoute(mode, item) {
  return '/' + mode + '/' + item.kind + '/' + item.id
}

function routeLabel(title) {
  document.title = title ? title + ' · Screen Room' : 'Screen Room'
}

function paint(html, signal) {
  if (!signal.aborted) main.innerHTML = html
}

function metadata(item, extended = false) {
  const detail = extended ? [item.duration, ...item.genres] : []
  return [item.kind === 'series' ? 'Series' : 'Movie', item.year, ...detail]
    .filter(Boolean).map(value => '<span>' + escape(value) + '</span>').join('')
}

function artwork(item, eager = false) {
  const fallback = '<span class="poster-fallback" aria-hidden="true">' + escape(item.title) + '</span>'
  return fallback + (item.artwork
    ? '<img src="' + escape(item.artwork) + '" alt="" referrerpolicy="no-referrer" ' +
      (eager ? '' : 'loading="lazy" ') + 'decoding="async">'
    : '')
}

main.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

function card(item, index, showKind) {
  return '<li><a class="title-card" data-route href="' + escape(routeTarget(itemRoute('title', item))) + '">' +
    '<div class="poster">' + artwork(item, index < 6) + '</div>' +
    '<h2>' + escape(item.title) + '</h2><span class="meta">' +
    (showKind ? metadata(item) : escape(item.year)) + '</span>' +
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

const retryButton = '<button class="button quiet" type="button" data-retry>Try again</button>'

function rowsHeader(searching, query, kind, genre) {
  if (searching) {
    return '<div class="section-head"><h1>Search</h1></div>' +
      '<form class="search-form" action="/search" role="search">' + searchIcon +
      '<input name="q" type="search" aria-label="Search movies and series" maxlength="100" placeholder="Search movies and series" value="' +
      escape(query) + '"><button class="button primary" type="submit">Search</button></form>'
  }
  const filter = genre ? '&genre=' + encodeURIComponent(genre) : ''
  const tabs = [['movie', 'Movies'], ['series', 'Series']].map(([value, name]) =>
    '<a href="' + escape(routeTarget('/?kind=' + value + filter)) + '" data-route' +
    (kind === value ? ' aria-current="page"' : '') + '>' + name + '</a>').join('')
  return '<div class="section-head"><h1>Browse</h1><div class="browse-filters">' +
    '<nav class="type-tabs" aria-label="Title type">' + tabs + '</nav><div class="category">' +
    '<select name="genre" aria-label="Genre">' +
    genres.map(value => '<option value="' + escape(value) + '"' +
      (value === genre ? ' selected' : '') + '>' + escape(value || 'All genres') + '</option>').join('') +
    '</select></div></div></div>'
}

async function list(url, signal) {
  const searching = url.pathname === '/search'
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const kind = url.searchParams.get('kind') === 'series' ? 'series' : 'movie'
  const genre = genres.includes(url.searchParams.get('genre')) ? url.searchParams.get('genre') : ''
  const page = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('page'), 10) || 1))
  routeLabel(searching ? 'Search' : 'Browse')
  const heading = rowsHeader(searching, query, kind, genre)
  if (searching && !query) {
    paint(heading, signal)
    return
  }
  const skeleton = '<p role="status" class="sr-only">Loading titles</p><ul class="grid skeleton" aria-hidden="true">' +
    '<li><div class="poster"></div></li>'.repeat(6) + '</ul>'
  const key = searching ? 'search:' + query : [kind, genre, page].join(':')
  const cached = catalogueCache.get(key)
  const saved = cached?.expires > Date.now()
  paint(heading + '<div id="list-body">' + (saved ? '' : skeleton) + '</div>', signal)
  try {
    const data = saved ? cached.data : await (searching ? search(query, signal) : browse({ kind, genre, page, signal }))
    if (signal.aborted) return
    if (!saved) {
      if (catalogueCache.size >= 16) catalogueCache.delete(catalogueCache.keys().next().value)
      catalogueCache.set(key, { data, expires: Date.now() + 90_000 })
    }
    const listBody = main.querySelector('#list-body')
    listBody.innerHTML = data.items.length
      ? '<ul class="grid">' + data.items.map((item, index) => card(item, index, searching)).join('') + '</ul>' +
        pageLinks(url, page, data.hasNext)
      : message('No titles found', searching ? 'Try another title.' : 'Choose another genre or page.') +
        pageLinks(url, page, data.hasNext)
  } catch (error) {
    if (!signal.aborted) {
      main.querySelector('#list-body').innerHTML = message('Catalogue unavailable', error.message,
        retryButton)
    }
  }
}

function titleLink(item) {
  return '<a class="return-link" data-route href="' + escape(routeTarget(itemRoute('title', item))) + '">' + icon('back') + 'Title details</a>'
}

function episodes(item) {
  const first = item.seasons[0]?.episodes[0]
  const button = item.kind === 'movie' || first
    ? '<a class="button primary" data-route href="' + escape(routeTarget(itemRoute('watch', item) +
      (first ? '?episode=' + encodeURIComponent(first.key) : ''))) + '">' + playIcon + (first ? 'Play first episode' : 'Play') + '</a>'
    : '<p class="muted">Video unavailable.</p>'
  const seasons = item.seasons.map((season, index) => '<details class="season"' + (index === 0 ? ' open' : '') + '><summary>' +
    escape(season.name) + '</summary><ul>' + season.episodes.map(ep =>
      '<li><a data-route href="' + escape(routeTarget(itemRoute('watch', item) + '?episode=' + encodeURIComponent(ep.key))) + '">' +
      '<span><span class="episode-number">' + ep.number + '</span>' + escape(ep.title) + '</span>' + playIcon +
      '</a></li>').join('') + '</ul></details>').join('')
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
    '</h1><p class="meta">' + metadata(item, true) + '</p>' +
    (item.description ? '<p class="synopsis">' + escape(item.description) + '</p>' : '') +
    button + '</div></section>' +
    (seasons ? '<section class="episode-list"><h2>Episodes</h2>' + seasons + '</section>' : '')
}

function watch(item, episode) {
  const allEpisodes = item.seasons.flatMap(season => season.episodes)
  const heading = episode ? episode.title : item.title
  routeLabel(heading)
  const next = episode ? allEpisodes[allEpisodes.indexOf(episode) + 1] : null
  return '<div class="watch-head">' + titleLink(item) + '<h1>' + escape(heading) + '</h1></div>' +
    '<div class="player" id="player">' +
    '<video id="video" playsinline preload="auto"></video>' +
    '<div class="player-state" role="status"><span class="spinner" aria-hidden="true"></span>Finding stream…</div>' +
    '<button class="player-start" type="button" aria-label="Play video" hidden>' + playIcon + '</button>' +
    '<div class="buffering" role="status" hidden><span class="spinner" aria-hidden="true"></span><span class="sr-only">Buffering</span></div>' +
    '<div class="controls" hidden><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Playback position" disabled>' +
    '<div class="controls-bar"><button type="button" id="toggle" aria-label="Play">' + playIcon +
    '</button><span id="time" class="player-time">0:00 / 0:00</span><span class="spacer"></span>' +
    '<button type="button" id="mute" aria-label="Mute">' + icon('volume') + '</button>' +
    '<button type="button" id="fullscreen" aria-label="Fullscreen">' + icon('full') + '</button>' +
    '</div></div></div><p id="video-error" class="muted" role="status" hidden></p>' +
    (next ? '<a class="button quiet next-episode" data-route href="' +
      escape(routeTarget(itemRoute('watch', item) + '?episode=' + encodeURIComponent(next.key))) +
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
    const durationKnown = Number.isFinite(video.duration) && video.duration > 0
    const seekable = video.seekable
    seek.disabled = !durationKnown || !seekable.length || seekable.end(seekable.length - 1) === 0
    if (!scrubbing) seek.value = durationKnown ? video.currentTime / video.duration * 100 : 0
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

  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'canplay']) {
    video.addEventListener(event, updateTime, { signal })
  }
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
      if (!seek.disabled) {
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (event.key === 'ArrowRight' ? 10 : -10)))
      }
    } else if (event.key.toLowerCase() === 'm') video.muted = !video.muted
    else if (event.key.toLowerCase() === 'f') toggleFullscreen()
  }, { signal })
  if (autoplay) video.play().catch(error => {
    if (!signal.aborted && error.name !== 'NotAllowedError') failed()
  })
}

async function startPlayback(item, episode, signal, autoplay) {
  const request = { kind: item.kind, title: item.title, year: item.year }
  if (episode) Object.assign(request, { season: episode.season, episode: episode.number })
  const state = main.querySelector('.player-state')
  try {
    let source
    if (hosted) {
      source = await hostedCircleStream(request, signal)
    } else {
      const response = await fetch('/api/play?' + new URLSearchParams(request), { signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      source = data.src
    }
    if (signal.aborted) return
    state.hidden = true
    main.querySelector('.controls').hidden = false
    main.querySelector('.player-start').hidden = false
    main.querySelector('video').src = source
    bindPlayer(signal, autoplay)
  } catch (error) {
    if (signal.aborted) return
    state.innerHTML = '<div><h2>Stream unavailable</h2><p>' + escape(error.message) + '</p>' + retryButton + '</div>'
  }
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

  if (url.pathname === '/' || url.pathname === '/search') return list(url, signal)

  const [, mode, kind, id] = url.pathname.split('/')
  if (!['title', 'watch'].includes(mode) || !kinds.has(kind) || !imdbId.test(id ?? '')) {
    return paint(message('Page not found', 'Open Browse or Search to find a title.'), signal)
  }
  paint('<p class="route-loading" role="status">Loading title…</p>', signal)
  try {
    const key = kind + ':' + id
    const cached = titleCache.get(key)
    const item = cached?.expires > Date.now() ? cached.item : await title(kind, id, signal)
    if (signal.aborted) return
    if (item !== cached?.item) {
      if (titleCache.size >= 36) titleCache.delete(titleCache.keys().next().value)
      titleCache.set(key, { item, expires: Date.now() + 300_000 })
    }
    if (mode === 'title') return paint('<div class="route-enter">' + details(item) + '</div>', signal)

    const selected = url.searchParams.get('episode')
    const episode = item.seasons.flatMap(season => season.episodes).find(candidate => candidate.key === selected)
    if (kind === 'series' && !episode) {
      return paint(titleLink(item) + message('Choose an episode', 'Open the title page to select an episode.'), signal)
    }
    paint('<div class="route-enter">' + watch(item, episode) + '</div>', signal)
    await startPlayback(item, episode, signal, autoplay)
  } catch (error) {
    if (!signal.aborted) paint(message('Title unavailable', error.message, retryButton), signal)
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
  if (!event.target.matches('.search-form')) return
  event.preventDefault()
  const query = new FormData(event.target).get('q').trim()
  go('/search' + (query ? '?' + new URLSearchParams({ q: query }) : ''))
})

main.addEventListener('change', event => {
  if (!event.target.matches('select[name="genre"]')) return
  const params = new URL(currentRoute, location.origin).searchParams
  if (event.target.value) params.set('genre', event.target.value)
  else params.delete('genre')
  params.delete('page')
  go('/' + (params.size ? '?' + params : ''))
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
