import { browse, search, title, imdbId, kinds } from './catalogue.js?v=2'
import { browserCircleStream, circleVideo, circleWebOrigins, mediaType, probeByteRange } from './playback.js?v=9'

const main = document.querySelector('main')
const circleTab = circleWebOrigins.includes(location.origin)
const hosted = location.protocol === 'https:' || circleTab
const publicHome = new URL('./', import.meta.url).href
const webPlayerHelp = new URL('web-play.html', publicHome).href
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
  jumpBack: '<path d="M4 10a8 8 0 1 1 1.8 7.1M4 10V4m0 6h6"/>',
  jumpAhead: '<path d="M20 10a8 8 0 1 0-1.8 7.1M20 10V4m0 6h-6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.4" fill="var(--control-surface)"/><circle cx="15" cy="17" r="2.4" fill="var(--control-surface)"/>',
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
  if (!hosted) return path
  if (circleTab && !path.startsWith('/watch/')) return publicHome + '#' + path
  if (!circleTab && path.startsWith('/watch/')) {
    const player = new URL('/api/posts?searchTerm=screen-room-browser&limit=1', circleWebOrigins[0])
    player.hash = path
    return player.href
  }
  return '#' + path
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
  const poster = episode?.artwork ? ' poster="' + escape(episode.artwork) + '"' : ''
  return '<div class="watch-head">' + titleLink(item) + '<h1>' + escape(heading) + '</h1>' +
    (episode ? '<p class="watch-episode">Season ' + episode.season + ', episode ' + episode.number + '</p>' : '') + '</div>' +
    '<div class="player" id="player"><div class="video-stage">' +
    '<video id="video" playsinline preload="metadata"' + poster + '></video>' +
    '<div class="player-state" role="status"><span class="spinner" aria-hidden="true"></span>Finding stream…</div>' +
    '<div class="player-state seek-recovery" hidden><div><h2>Seek stalled</h2><p role="status"></p>' +
    '<div class="player-state-actions"><button class="button primary" type="button" data-retry-seek>Retry seek</button>' +
    '<button class="button quiet" type="button" data-resume-seek>Resume playback</button></div></div></div>' +
    '<button class="player-start" type="button" aria-label="Play video" hidden>' + playIcon + '</button>' +
    '<div class="buffering" role="status" hidden><span class="spinner" aria-hidden="true"></span><span class="sr-only">Buffering</span></div></div>' +
    '<div class="controls" hidden><div class="player-timeline"><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Playback position" disabled>' +
    '<span id="time" class="player-time">0:00 / 0:00</span></div>' +
    '<div class="controls-bar"><button type="button" id="toggle" aria-label="Play">' + playIcon + '</button>' +
    '<button type="button" class="jump" data-jump="-10" aria-label="Back 10 seconds" disabled>' + icon('jumpBack') + '<span aria-hidden="true">10</span></button>' +
    '<button type="button" class="jump" data-jump="10" aria-label="Forward 10 seconds" disabled>' + icon('jumpAhead') + '<span aria-hidden="true">10</span></button>' +
    '<span class="spacer"></span>' +
    '<button type="button" id="mute" aria-label="Mute">' + icon('volume') + '</button>' +
    '<button type="button" id="settings-toggle" aria-label="Playback settings" title="Playback settings" aria-expanded="false" aria-controls="player-settings">' + icon('settings') + '</button>' +
    '<button type="button" id="fullscreen" aria-label="Fullscreen">' + icon('full') + '</button></div>' +
    '<div class="player-settings-panel" id="player-settings" hidden><label hidden>Audio <select id="audio-track"></select></label>' +
    '<label>Speed <select id="playback-speed"><option value="0.75">0.75×</option><option value="1" selected>Normal</option>' +
    '<option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>' +
    '<label>Volume <input id="player-volume" type="range" min="0" max="1" step="0.05" value="1"></label>' +
    '</div></div></div><p id="video-error" class="muted" role="status" hidden></p>' +
    '<p id="audio-status" class="muted" role="status" hidden>No audio track has decoded. ' +
    'Your browser may not support this stream’s audio format.</p>' +
    '<div class="watch-actions"><div class="playback-options" hidden>' +
    '<button class="button quiet" type="button" data-other-stream hidden>Try another stream</button></div>' +
    (next ? '<a class="button quiet next-episode" data-route href="' +
      escape(routeTarget(itemRoute('watch', item) + '?episode=' + encodeURIComponent(next.key))) +
      '">Next episode' + icon('expand') + '</a>' : '') + '</div>' +
    '<p id="stream-status" class="muted" role="status" hidden></p>' +
    '<details class="playback-debug" hidden><summary>Playback details</summary><pre></pre>' +
    '<button class="button quiet" type="button" data-test-sound>Play test tone</button>' +
    '<p role="status" data-sound-result></p></details>'
}

function bindPlayer(signal, autoplay, reportAudio) {
  const video = main.querySelector('video')
  if (!video) return
  const player = main.querySelector('#player')
  const start = main.querySelector('.player-start')
  const toggle = main.querySelector('#toggle')
  const seek = main.querySelector('#seek')
  const time = main.querySelector('#time')
  const mute = main.querySelector('#mute')
  const volume = main.querySelector('#player-volume')
  const speed = main.querySelector('#playback-speed')
  const settings = main.querySelector('#settings-toggle')
  const settingsPanel = main.querySelector('#player-settings')
  const jumps = player.querySelectorAll('[data-jump]')
  const error = main.querySelector('#video-error')
  const audioStatus = main.querySelector('#audio-status')
  const audioTrack = main.querySelector('#audio-track')
  const buffering = main.querySelector('.buffering')
  const recovery = main.querySelector('.seek-recovery')
  const resume = recovery.querySelector('[data-resume-seek]')
  const retry = recovery.querySelector('[data-retry-seek]')
  const debug = main.querySelector('.playback-debug')
  const testSound = debug.querySelector('[data-test-sound]')
  const soundResult = debug.querySelector('[data-sound-result]')
  const source = video.getAttribute('src')
  const audioSource = circleTab ? circleVideo(source) : null
  const matroska = audioSource && mediaType(audioSource) === 'video/x-matroska'
  let audioContext
  let audioRecovery
  let audioModule
  let audioPromise
  let audioChoices
  let audioSelection
  let decodedAudio
  let userMuted = video.muted
  let volumeLevel = video.volume
  let lastVolume = volumeLevel || 1
  let playRequest
  let audioFailure
  let bufferTimer
  let seekTimer
  let scrubbing = false
  let duration = 0
  let lastPlayed = 0
  let pendingSeek
  let stalledSeek
  let rangeCheck
  let rangeProbe
  let audioReported = false
  let seekDetails = []

  function formatTime(value) {
    const seconds = Number.isFinite(value) ? Math.floor(value) : 0
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const part = String(seconds % 60).padStart(2, '0')
    return (hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes) + ':' + part
  }

  function updateTime() {
    if (Number.isFinite(video.duration) && video.duration > 0) duration = video.duration
    const seekable = video.seekable
    if (!pendingSeek && !stalledSeek && !video.seeking && video.readyState >= 2) lastPlayed = video.currentTime
    seek.disabled = Boolean(stalledSeek) || !duration ||
      (!pendingSeek && (!seekable.length || seekable.end(seekable.length - 1) === 0))
    for (const jump of jumps) jump.disabled = seek.disabled
    const position = pendingSeek?.target ?? stalledSeek?.target ?? video.currentTime
    if (!scrubbing) seek.value = duration ? position / duration * 100 : 0
    const preview = scrubbing ? Number(seek.value) * duration / 100 : position
    time.textContent = formatTime(preview) + ' / ' + formatTime(duration)
    seek.setAttribute('aria-valuetext', formatTime(preview) + ' of ' + formatTime(duration))
    seek.style.setProperty('--played', seek.value + '%')
    let start = 0
    let end = 0
    const buffered = video.buffered
    for (let index = 0; index < buffered.length; index++) {
      if (buffered.start(index) > position) break
      if (buffered.end(index) >= position) {
        start = buffered.start(index)
        end = buffered.end(index)
        break
      }
    }
    seek.style.setProperty('--buffer-start', (duration ? start / duration * 100 : 0) + '%')
    seek.style.setProperty('--buffer-end', (duration ? end / duration * 100 : 0) + '%')
  }

  function formatRanges(ranges) {
    return Array.from({ length: ranges.length }, (_, index) =>
      formatTime(ranges.start(index)) + '–' + formatTime(ranges.end(index))).join(', ') || 'empty'
  }

  function renderDebug() {
    const url = new URL(source, location.href)
    const tracks = video.audioTracks
    debug.querySelector('pre').textContent = [
      main.querySelector('.watch-head h1').textContent,
      'Source: ' + url.origin + (mediaType(url) ? ' (' + mediaType(url) + ')' : ''),
      'Current position: ' + formatTime(video.currentTime) + ' / ' + formatTime(duration),
      'Audio: ' + (userMuted ? 'muted' : 'unmuted') + ', volume ' + Math.round(volumeLevel * 100) + '%',
      'Audio decoder: ' + (audioRecovery ?? 'native') + (audioFailure ? ' (' + audioFailure + ')' : ''),
      'Decoded bytes: audio ' + (video.webkitAudioDecodedByteCount ?? 'unavailable') +
        ', video ' + (video.webkitVideoDecodedByteCount ?? 'unavailable'),
      'Audio tracks: ' + (tracks ? Array.from(tracks).filter(track => track.enabled).length +
        ' enabled / ' + tracks.length : 'unavailable'),
      'Media state: ready ' + video.readyState + ', network ' + video.networkState +
        (video.error ? ', error ' + video.error.code : ''),
      ...seekDetails
    ].join('\n')
  }

  function showDebug(attempt, reason) {
    const probe = rangeProbe?.status ? 'HTTP ' + rangeProbe.status +
      (rangeProbe.range ? ' (' + rangeProbe.range + ')' : '') : rangeProbe?.error ?? 'not run'
    seekDetails = [
      'Seek ' + formatTime(attempt.from) + ' → ' + formatTime(attempt.target),
      'Result: ' + reason,
      'Range bytes=1-1: ' + probe,
      'Buffered before: ' + attempt.buffered,
      'Buffered after: ' + formatRanges(video.buffered),
      'Seekable: ' + formatRanges(video.seekable)
    ]
    renderDebug()
  }

  debug.hidden = false
  debug.addEventListener('toggle', () => { if (debug.open) renderDebug() }, { signal })
  testSound.addEventListener('click', async () => {
    let context
    const stop = () => { void context?.close().catch(() => {}) }
    testSound.disabled = true
    soundResult.textContent = ''
    renderDebug()
    try {
      const Audio = window.AudioContext ?? window.webkitAudioContext
      context = new Audio()
      signal.addEventListener('abort', stop, { once: true })
      await context.resume()
      if (signal.aborted) return
      const tone = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime
      tone.frequency.value = 440
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.05, now + 0.04)
      gain.gain.linearRampToValueAtTime(0, now + 0.4)
      tone.connect(gain).connect(context.destination)
      await new Promise(resolve => {
        function finish() {
          signal.removeEventListener('abort', finish)
          resolve()
        }
        tone.addEventListener('ended', finish, { once: true })
        signal.addEventListener('abort', finish, { once: true })
        tone.start(now)
        tone.stop(now + 0.4)
      })
      if (!signal.aborted) soundResult.textContent = 'Test tone finished.'
    } catch {
      soundResult.textContent = 'The browser could not play the test tone.'
    } finally {
      signal.removeEventListener('abort', stop)
      if (context && context.state !== 'closed') await context.close().catch(() => {})
      testSound.disabled = false
    }
  }, { signal })

  function stopBuffering() {
    clearTimeout(bufferTimer)
    bufferTimer = undefined
    buffering.hidden = true
  }

  function showBuffering() {
    if (bufferTimer || !buffering.hidden) return
    bufferTimer = setTimeout(() => {
      bufferTimer = undefined
      buffering.hidden = false
    }, 220)
  }

  function syncPlayButton() {
    const playing = pendingSeek?.play ?? (Boolean(playRequest) || !video.paused)
    toggle.disabled = Boolean(stalledSeek)
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    toggle.innerHTML = playing ? icon('pause') : playIcon
    start.hidden = playing || Boolean(pendingSeek || stalledSeek || video.currentTime > 0 || video.error)
  }

  function failed() {
    if (signal.aborted || stalledSeek) return
    if (pendingSeek) return stopSeek('media error')
    playRequest = undefined
    stopBuffering()
    start.hidden = true
    error.textContent = 'This video could not play. The source may be unavailable or the format may be unsupported.'
    error.hidden = false
    reportAudio?.('failed')
  }

  function play() {
    playRequest = {}
    if (matroska) startBrowserAudio()
    resumePlayback()
  }

  function resumePlayback() {
    const request = playRequest
    if (!request || request.waiting || signal.aborted) return
    if (audioContext && audioRecovery !== 'native' && !userMuted && volumeLevel > 0) {
      showBuffering()
      syncPlayButton()
      if (decodedAudio) {
        request.waiting = true
        void decodedAudio.ready(video.currentTime).then(ready => {
          if (ready && playRequest === request) playVideo()
        })
      }
      return
    }
    playVideo()
  }

  function playVideo() {
    playRequest = undefined
    video.play().catch(error => {
      stopBuffering()
      syncPlayButton()
      if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') failed()
    })
  }

  function pausePlayback() {
    playRequest = undefined
    video.pause()
    stopBuffering()
    syncPlayButton()
  }

  function checkRange() {
    rangeCheck ??= probeByteRange(source, signal)
    return rangeCheck
  }

  function finishSeek() {
    const attempt = pendingSeek
    if (!attempt?.applied || video.seeking) return
    const needsPlayback = attempt.play && !video.ended && attempt.target < duration
    if (video.readyState < (needsPlayback ? 3 : 2)) return
    if (needsPlayback && video.currentTime < attempt.target + 0.2) return
    clearTimeout(seekTimer)
    pendingSeek = undefined
    stopBuffering()
    syncPlayButton()
  }

  function applySeek() {
    if (!pendingSeek || pendingSeek.checkingRange || pendingSeek.applied || video.readyState < 1) return
    pendingSeek.applied = true
    pendingSeek.target = Math.min(pendingSeek.target, video.duration)
    if (audioContext && audioRecovery !== 'native' && !userMuted && volumeLevel > 0) video.pause()
    decodedAudio?.prime(pendingSeek.target)
    video.currentTime = pendingSeek.target
    if (pendingSeek.play) play()
    finishSeek()
  }

  function startSeek(attempt, reopen = false) {
    clearTimeout(seekTimer)
    stalledSeek = undefined
    pendingSeek = { ...attempt, applied: false, checkingRange: false }
    recovery.hidden = true
    error.hidden = true
    showBuffering()
    seekTimer = setTimeout(() => stopSeek('8-second timeout'), 8000)
    if (reopen) video.src = source
    else applySeek()
    syncPlayButton()
    updateTime()
  }

  function stopSeek(reason) {
    const attempt = pendingSeek
    if (!attempt || signal.aborted) return
    clearTimeout(seekTimer)
    stalledSeek = attempt
    pendingSeek = undefined
    playRequest = undefined
    stopBuffering()
    showDebug(attempt, reason)
    decodedAudio?.reset()
    video.pause()
    video.removeAttribute('src')
    video.load()
    recovery.querySelector('p').textContent = 'Could not reach ' + formatTime(attempt.target) + '. Loading stopped.'
    const fallback = Math.abs(attempt.target - attempt.from) < 1 ? 0 : attempt.from
    resume.textContent = fallback ? 'Resume at ' + formatTime(fallback) : 'Start over'
    resume.hidden = !fallback && attempt.target === 0
    recovery.hidden = false
    syncPlayButton()
    updateTime()
  }

  async function seekTo(target) {
    if (!duration || seek.disabled || !Number.isFinite(target)) return
    target = Math.max(0, Math.min(duration, target))
    const attempt = {
      target, from: pendingSeek?.from ?? lastPlayed, play: pendingSeek?.play ?? (Boolean(playRequest) || !video.paused),
      buffered: formatRanges(video.buffered)
    }
    const buffered = video.buffered
    const inBuffer = Array.from({ length: buffered.length }, (_, index) =>
      target >= buffered.start(index) && target < buffered.end(index)).some(Boolean)
    if (!inBuffer) {
      if (!rangeProbe && !decodedAudio) {
        clearTimeout(seekTimer)
        attempt.checkingRange = true
        pendingSeek = attempt
        showBuffering()
        updateTime()
        rangeProbe = await checkRange()
        if (signal.aborted || pendingSeek !== attempt) return
      }
      if (rangeProbe?.ignored) {
        showDebug(attempt, 'server ignored the requested byte range')
        pendingSeek = undefined
        stopBuffering()
        error.textContent = 'Circle sent a full-file response. Seek within the buffered part or keep watching.'
        error.hidden = false
        syncPlayButton()
        updateTime()
        return
      }
    }
    startSeek(attempt)
  }

  function flipPlayback() {
    if (stalledSeek) return
    if (pendingSeek) {
      pendingSeek.play = !pendingSeek.play
      if (!pendingSeek.play) pausePlayback()
      else if (pendingSeek.applied) play()
      syncPlayButton()
      return finishSeek()
    }
    if (video.paused && !playRequest) {
      error.hidden = true
      play()
    } else pausePlayback()
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else if (player.requestFullscreen) player.requestFullscreen().catch(() => {})
    else video.webkitEnterFullscreen?.()
  }

  for (const event of ['loadstart', 'timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'canplay', 'playing', 'seeked']) {
    video.addEventListener(event, () => {
      if (event === 'loadedmetadata') applySeek()
      if (event === 'loadstart' || event === 'loadedmetadata') {
        prepareAudio()
        if (audioContext && !audioRecovery) startBrowserAudio()
      }
      if (event === 'canplay' || event === 'playing' || event === 'seeked' || event === 'timeupdate') {
        finishSeek()
      }
      if (!pendingSeek && !playRequest && (event === 'canplay' || event === 'playing' || event === 'seeked')) stopBuffering()
      updateTime()
    }, { signal })
  }
  function showAudioOptions(tracks, id, native = false) {
    const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })
    const options = tracks.map(({ name, language, index, disposition }) => {
      const lang = language !== 'und' && /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language) ? names.of(language) : ''
      const label = name || lang || 'Track ' + (index + 1)
      return new Option(label + (disposition?.original ? ' (Original)' : ''), index, false, index === id)
    })
    audioTrack.replaceChildren(...options)
    audioTrack.parentElement.hidden = native ? options.length < 2 : !options.length
  }

  function prepareAudio() {
    if (!matroska || typeof AudioContext !== 'function') return
    if (!audioModule) {
      audioModule = import('./browser-audio.js?v=6')
      void audioModule.catch(() => {})
    }
    if (!video.currentSrc) return
    if (!audioPromise) {
      audioPromise = audioModule.then(async module => {
        const engine = await module.openBrowserAudio(source, checkRange, signal)
        signal.throwIfAborted()
        audioChoices = engine.choices
        showAudioOptions(audioChoices, audioChoices[0]?.index)
        const warmDecoders = new Map()
        void primeStart()
        return { module, engine, warmDecoders }

        async function primeStart() {
          for (const choice of audioChoices) {
            if (signal.aborted || audioSelection) return
            const decoder = engine.decoder(choice)
            warmDecoders.set(choice, decoder)
            try {
              const sink = await decoder
              if (!sink) continue
              if (!audioSelection) module.warmAudioStart(sink, signal)
              return
            } catch {}
          }
        }
      })
      void audioPromise.catch(() => {})
    }
    return audioPromise
  }

  function startBrowserAudio(preferredIndex) {
    if (!matroska || typeof AudioContext !== 'function' || (audioRecovery && preferredIndex === undefined)) return
    try {
      audioContext ??= new AudioContext()
      void audioContext.resume().catch(() => {})
    } catch { return }
    const prepared = prepareAudio()
    if (!prepared) return
    audioSelection?.abort()
    audioSelection = new AbortController()
    const selection = AbortSignal.any([signal, audioSelection.signal])
    if (playRequest) playRequest.waiting = false
    decodedAudio = undefined
    audioRecovery = 'loading'
    audioFailure = undefined
    audioStatus.hidden = true
    syncVolume()
    void chooseAudio()

    function useNative(error) {
      if (selection.aborted) return
      if (playRequest) playRequest.waiting = false
      audioRecovery = 'native'
      audioFailure = error?.message
      if (audioFailure) audioStatus.textContent = 'Browser audio could not start. ' + audioFailure
      syncVolume()
      updateAudio()
      resumePlayback()
    }

    async function chooseAudio() {
      try {
        const { module, engine, warmDecoders } = await prepared
        const selected = audioChoices.find(choice => choice.index === preferredIndex)
        const order = selected ? [selected, ...audioChoices.filter(choice => choice !== selected)] : audioChoices
        await useChoices(order)

        async function useChoices(choices, failure) {
          for (const [index, choice] of choices.entries()) {
            if (selection.aborted) return
            try {
              const sink = await (warmDecoders.get(choice) ?? engine.decoder(choice))
              selection.throwIfAborted()
              if (!sink) continue
              const attempt = new AbortController()
              const trackSignal = AbortSignal.any([selection, attempt.signal])
              audioTrack.value = String(choice.index)
              decodedAudio = module.playDecodedAudio(video, sink, audioContext, trackSignal, {
                volume: userMuted ? 0 : volumeLevel,
                started() {
                  audioRecovery = 'active'
                  audioFailure = undefined
                  audioStatus.hidden = true
                  if (!audioReported) reportAudio?.('decoded')
                  audioReported = true
                },
                starved() {
                  if (video.paused || video.seeking) return
                  video.pause()
                  play()
                },
                failed(error) {
                  attempt.abort()
                  decodedAudio = undefined
                  audioRecovery = 'loading'
                  if (playRequest) playRequest.waiting = false
                  void useChoices(choices.slice(index + 1), error)
                }
              })
              resumePlayback()
              return
            } catch (error) { failure = error }
          }
          useNative(failure ?? new Error('No supported audio tracks were available.'))
        }
      } catch (error) { useNative(error) }
    }
  }

  function updateAudio() {
    if (userMuted || volumeLevel === 0 || audioRecovery === 'loading' || audioRecovery === 'active') return
    const decoded = video.webkitAudioDecodedByteCount
    if (decoded > 0 && !audioReported) {
      audioReported = true
      reportAudio?.('decoded')
    }
    const played = video.played
    if (!played.length || video.paused || video.seeking || pendingSeek || stalledSeek ||
        !video.webkitVideoDecodedByteCount) return
    const span = played.end(played.length - 1) - played.start(played.length - 1)
    audioStatus.hidden = decoded !== 0 || span < 2
    if (decoded === 0 && span >= 4 && video.currentTime < 7) {
      reportAudio?.('silent')
    }
  }
  video.addEventListener('playing', updateAudio, { signal })
  video.addEventListener('timeupdate', updateAudio, { signal })
  if (video.audioTracks) {
    function updateAudioTracks() {
      if (audioChoices) return
      const tracks = Array.from(video.audioTracks)
      const hindi = tracks.findIndex(track => /^(?:hi|hin)(?:-|$)/i.test(track.language) || /\bHindi\b/i.test(track.label))
      if (hindi >= 0) tracks.forEach((track, index) => { track.enabled = index === hindi })
      showAudioOptions(tracks.map((track, index) => ({
        index, name: track.label, language: track.language
      })), tracks.findIndex(track => track.enabled), true)
    }
    video.addEventListener('loadedmetadata', updateAudioTracks, { signal })
    video.audioTracks.addEventListener('addtrack', updateAudioTracks, { signal })
  }
  audioTrack.addEventListener('change', () => {
    if (audioChoices) startBrowserAudio(Number(audioTrack.value))
    else Array.from(video.audioTracks ?? []).forEach((track, index) => { track.enabled = index === Number(audioTrack.value) })
  }, { signal })
  video.addEventListener('waiting', () => {
    if (pendingSeek || (!video.paused && !stalledSeek)) showBuffering()
  }, { signal })
  for (const event of ['play', 'pause', 'ended']) {
    video.addEventListener(event, () => {
      if (event === 'ended') finishSeek()
      syncPlayButton()
      if (video.paused && !pendingSeek && !playRequest) stopBuffering()
    }, { signal })
  }
  video.addEventListener('error', failed, { signal })
  signal.addEventListener('abort', () => {
    clearTimeout(seekTimer)
    stopBuffering()
    if (audioContext) void audioContext.close().catch(() => {})
    video.pause()
    video.removeAttribute('src')
    video.load()
  }, { once: true })
  seek.addEventListener('input', () => {
    scrubbing = true
    updateTime()
  })
  seek.addEventListener('change', () => {
    const target = Number(seek.value) * duration / 100
    scrubbing = false
    seekTo(target)
  })
  for (const jump of jumps) {
    jump.addEventListener('click', () => seekTo((pendingSeek?.target ?? video.currentTime) + Number(jump.dataset.jump)), { signal })
  }
  retry.addEventListener('click', () => {
    if (stalledSeek) startSeek(stalledSeek, true)
  })
  resume.addEventListener('click', () => {
    if (!stalledSeek) return
    const target = Math.abs(stalledSeek.target - stalledSeek.from) < 1 ? 0 : stalledSeek.from
    startSeek({ ...stalledSeek, target }, true)
  })
  video.addEventListener('click', flipPlayback)
  toggle.addEventListener('click', flipPlayback)
  start.addEventListener('click', flipPlayback)
  function toggleSound() {
    userMuted = !(userMuted || volumeLevel === 0)
    if (!userMuted && volumeLevel === 0) {
      volumeLevel = lastVolume
      video.volume = volumeLevel
    }
    syncVolume()
  }
  function syncVolume() {
    const muted = userMuted || volumeLevel === 0
    video.muted = muted || audioRecovery === 'loading' || audioRecovery === 'active'
    decodedAudio?.setVolume(muted ? 0 : volumeLevel)
    volume.value = volumeLevel
    if (muted) audioStatus.hidden = true
    mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
    mute.innerHTML = icon(muted ? 'muted' : 'volume')
    if (debug.open) renderDebug()
  }
  mute.addEventListener('click', toggleSound, { signal })
  video.addEventListener('volumechange', syncVolume, { signal })
  volume.addEventListener('input', () => {
    userMuted = false
    volumeLevel = Number(volume.value)
    if (volumeLevel) lastVolume = volumeLevel
    video.volume = volumeLevel
    syncVolume()
  }, { signal })
  speed.addEventListener('change', () => { video.playbackRate = Number(speed.value) }, { signal })
  function showSettings(open) {
    settingsPanel.hidden = !open
    settings.setAttribute('aria-expanded', String(open))
  }
  settings.addEventListener('click', () => showSettings(settingsPanel.hidden), { signal })
  document.addEventListener('pointerdown', event => {
    if (!settingsPanel.hidden && !settings.contains(event.target) && !settingsPanel.contains(event.target)) showSettings(false)
  }, { signal })
  const fullscreen = main.querySelector('#fullscreen')
  fullscreen.addEventListener('click', toggleFullscreen, { signal })
  document.addEventListener('fullscreenchange', () => {
    fullscreen.setAttribute('aria-label', document.fullscreenElement === player ? 'Exit fullscreen' : 'Fullscreen')
  }, { signal })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsPanel.hidden) {
      showSettings(false)
      settings.focus()
      return
    }
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
        event.target.closest?.('a, input, button, select, summary, textarea, [contenteditable]')) return
    if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault()
      flipPlayback()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      seekTo((pendingSeek?.target ?? video.currentTime) + (event.key === 'ArrowRight' ? 10 : -10))
    } else if (event.key.toLowerCase() === 'm' && !event.repeat) toggleSound()
    else if (event.key.toLowerCase() === 'f') toggleFullscreen()
  }, { signal })
  prepareAudio()
  if (autoplay) play()
}

async function startPlayback(item, episode, signal, autoplay) {
  const watchPage = main.querySelector('.route-enter')
  const state = watchPage.querySelector('.player-state')
  if (hosted && !circleTab) {
    state.innerHTML = '<div><p>Playback needs a connection that can reach Circle.</p><div class="player-state-actions">' +
      '<a class="button primary" href="' + escape(routeTarget(currentRoute)) + '" rel="noreferrer">' +
      playIcon + 'Play on Circle</a><a class="button quiet" href="' + escape(webPlayerHelp + '#' + currentRoute) +
      '">Player setup</a></div></div>'
    return
  }

  const request = { kind: item.kind, id: item.id, title: item.title, year: item.year }
  if (episode) Object.assign(request, { season: episode.season, episode: episode.number })
  const tried = new Set()
  const audioKey = 'screenroom.audio.' + item.id + (episode ? '.' + episode.key : '')
  let preferredSource
  if (circleTab) {
    try { preferredSource = circleVideo(sessionStorage.getItem(audioKey))?.href } catch {}
  }
  let recoveryTried = false
  let activePlayer

  function handleAudio(source, state) {
    if (state === 'decoded') {
      if (new URL(source).search) return
      preferredSource = source
      try { sessionStorage.setItem(audioKey, source) } catch {}
      return
    }
    if (state === 'failed' && preferredSource !== source) return
    if (preferredSource === source) {
      preferredSource = undefined
      try { sessionStorage.removeItem(audioKey) } catch {}
    }
    const button = watchPage.querySelector('[data-other-stream]')
    if (!recoveryTried && !button.disabled) {
      recoveryTried = true
      void findAnother(button, state === 'silent')
    }
  }

  function showPlayer(source, playNow) {
    tried.add(source)
    activePlayer = new AbortController()
    watchPage.querySelector('.player-state').hidden = true
    watchPage.querySelector('.controls').hidden = false
    watchPage.querySelector('.player-start').hidden = false
    if (circleTab) {
      watchPage.querySelector('.playback-options').hidden = false
      watchPage.querySelector('[data-other-stream]').hidden = false
    }
    watchPage.querySelector('video').src = source
    bindPlayer(AbortSignal.any([signal, activePlayer.signal]), playNow,
      circleTab ? state => handleAudio(source, state) : undefined)
  }

  async function findAnother(button, automatic = false) {
    const status = watchPage.querySelector('#stream-status')
    const video = watchPage.querySelector('video')
    button.disabled = true
    status.textContent = 'Finding another stream…'
    status.hidden = false
    try {
      const source = await browserCircleStream(request, signal, location.origin, tried)
      if (signal.aborted) return
      if (automatic && (video.paused || video.muted || video.volume === 0 || video.seeking ||
          video.currentTime > 12 || video.webkitAudioDecodedByteCount > 0)) {
        button.disabled = false
        status.hidden = true
        return
      }
      const restoreFocus = document.activeElement === button
      activePlayer.abort()
      watchPage.innerHTML = watch(item, episode)
      showPlayer(source, true)
      if (restoreFocus) watchPage.querySelector('#toggle').focus({ preventScroll: true })
    } catch (error) {
      if (signal.aborted) return
      button.disabled = false
      status.textContent = error.message
    }
  }

  watchPage.addEventListener('click', event => {
    const button = event.target.closest('[data-other-stream]')
    if (circleTab && button && !button.disabled) void findAnother(button)
  }, { signal })

  try {
    let source
    if (circleTab) {
      source = preferredSource ?? await browserCircleStream(request, signal, location.origin)
    } else {
      const response = await fetch('/api/play?' + new URLSearchParams(request), { signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      source = data.src
    }
    if (signal.aborted) return
    showPlayer(source, autoplay)
  } catch (error) {
    if (signal.aborted) return
    state.innerHTML = '<div><h2>Stream unavailable</h2><p>' + escape(error.message) + '</p>' + retryButton + '</div>'
  }
}

async function render(focus = false, autoplay = false) {
  navigation?.abort()
  if (circleTab && !currentRoute.startsWith('/watch/')) {
    location.replace(routeTarget(currentRoute))
    return
  }
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
  if (!link || link.origin !== location.origin || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
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
