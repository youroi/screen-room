import { browserAudioRoute, probeByteRange } from './playback.js?v=8'

const video = document.querySelector('video')
const button = document.querySelector('button')
const status = document.querySelector('#audio-status')
const route = browserAudioRoute(location)
const audioPackage = 'https://cdn.jsdelivr.net/npm/'

if (route) {
  video.src = route.source
  video.currentTime = route.time
  button.addEventListener('click', activate)
} else {
  button.disabled = true
  status.textContent = 'Open Browser audio from a Circle episode.'
}

async function activate() {
  button.disabled = true
  status.textContent = 'Preparing audio…'
  const lifetime = new AbortController()
  const { signal } = lifetime
  let context
  let input
  function cleanup() {
    lifetime.abort()
    input?.dispose()
    void context?.close().catch(() => {})
    button.disabled = false
    button.hidden = false
  }
  window.addEventListener('pagehide', cleanup, { signal })

  try {
    context = new AudioContext()
    await context.resume()
    const range = await probeByteRange(route.source, signal)
    if (range.status !== 206 || !range.range) throw new Error('The file server did not return a readable byte range.')

    const [{ Input, MATROSKA, UrlSource, AudioBufferSink }, { registerAc3Decoder }] = await Promise.all([
      import(audioPackage + 'mediabunny@1.66.0/+esm'),
      import(audioPackage + '@mediabunny/ac3@1.66.1/+esm')
    ])
    if (signal.aborted) return
    registerAc3Decoder()
    input = new Input({ formats: [MATROSKA], source: new UrlSource(route.source, {
      requestInit: { credentials: 'omit', redirect: 'error' }, maxCacheSize: 16 * 1024 * 1024
    }) })
    const tracks = await input.getAudioTracks()
    const codecs = await Promise.all(tracks.map(track => track.getCodec()))
    const track = tracks[codecs.findIndex(codec => codec === 'ac3' || codec === 'eac3')]
    if (!track) throw new Error('This file has no Dolby Digital audio track.')

    playDecodedAudio(new AudioBufferSink(track), context, signal, error => {
      cleanup()
      video.pause()
      status.textContent = 'Browser audio stopped. ' + error.message
    })
    video.controls = true
    await video.play()
    if (signal.aborted) return
    button.hidden = true
    status.textContent = 'Browser audio enabled.'
  } catch (error) {
    cleanup()
    status.textContent = 'Browser audio could not start. ' + error.message
  }
}

function playDecodedAudio(sink, context, signal, failed) {
  const gain = context.createGain()
  gain.connect(context.destination)
  const scheduled = new Set()
  let generation = 0

  function stop() {
    generation++
    for (const source of scheduled) source.stop()
    scheduled.clear()
  }

  function setVolume() {
    gain.gain.value = video.muted ? 0 : video.volume
  }

  async function start() {
    stop()
    if (video.paused || video.seeking || video.readyState < 3 || signal.aborted) return
    const id = generation
    const position = video.currentTime
    const clock = context.currentTime
    const rate = video.playbackRate
    try {
      for await (const { buffer, timestamp } of sink.buffers(position)) {
        while (id === generation && timestamp > video.currentTime + 1) {
          await new Promise(resolve => setTimeout(resolve, 75))
        }
        if (id !== generation) return
        const when = clock + (timestamp - position) / rate
        const skip = Math.max(0, (context.currentTime - when) * rate)
        if (skip >= buffer.duration) continue
        const source = context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = rate
        source.connect(gain)
        scheduled.add(source)
        source.onended = () => { scheduled.delete(source); source.disconnect() }
        source.start(Math.max(when, context.currentTime), skip)
      }
    } catch (error) {
      if (id === generation) failed(error)
    }
  }

  for (const event of ['playing', 'seeked', 'ratechange']) video.addEventListener(event, start, { signal })
  for (const event of ['pause', 'seeking', 'waiting', 'ended']) video.addEventListener(event, stop, { signal })
  video.addEventListener('volumechange', setVolume, { signal })
  signal.addEventListener('abort', stop, { once: true })
  setVolume()
}
