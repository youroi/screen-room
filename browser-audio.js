import { probeByteRange } from './playback.js?v=9'

const audioPackage = 'https://cdn.jsdelivr.net/npm/'
const maxRangeSize = 512 * 1024

export async function enableBrowserAudio(video, source, context, playerSignal, failed) {
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, playerSignal])
  let input
  function cleanup() {
    lifetime.abort()
  }
  signal.addEventListener('abort', () => input?.dispose(), { once: true })

  try {
    const range = await probeByteRange(source, signal)
    signal.throwIfAborted()
    const direct = range.status === 206 && range.range
    const readMedia = window.screenRoomReadMedia
    if (!direct && !readMedia) throw new Error('Install the Screen Room script from Circle web player setup in Via.')
    if (range.ignored) throw new Error('The file server does not support byte ranges.')

    const [{ Input, MATROSKA, UrlSource, CustomSource, AudioBufferSink }, { registerAc3Decoder }] = await Promise.all([
      import(audioPackage + 'mediabunny@1.66.0/+esm'),
      import(audioPackage + '@mediabunny/ac3@1.66.1/+esm')
    ])
    signal.throwIfAborted()
    registerAc3Decoder()
    const data = direct ? new UrlSource(source, {
      requestInit: { credentials: 'omit', redirect: 'error' }, maxCacheSize: 16 * 1024 * 1024
    }) : new CustomSource(viaSource(source, readMedia, signal))
    input = new Input({ formats: [MATROSKA], source: data })
    const tracks = await input.getAudioTracks()
    const codecs = await Promise.all(tracks.map(track => track.getCodec()))
    const track = tracks[codecs.findIndex(codec => codec === 'ac3' || codec === 'eac3')]
    if (!track) throw new Error('Unsupported audio track: ' + (codecs.filter(Boolean).join(', ') || 'unknown codec') + '.')
    await context.resume()
    signal.throwIfAborted()
    if (video.webkitAudioDecodedByteCount > 0) {
      cleanup()
      return null
    }

    playDecodedAudio(video, new AudioBufferSink(track), context, signal, error => {
      cleanup()
      failed(error)
    })
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}

function viaSource(source, readMedia, signal) {
  let size
  return {
    prefetchProfile: 'fileSystem', maxCacheSize: 8 * 1024 * 1024,
    async getSize() {
      const { headers } = await readMedia(source, undefined, undefined, signal)
      size = Number(/^content-length:\s*(\d+)\s*$/mi.exec(headers)?.[1])
      if (!Number.isSafeInteger(size) || size <= 0 || !/^accept-ranges:\s*bytes\s*$/mi.test(headers)) {
        throw new Error('The file server does not support readable byte ranges.')
      }
      return size
    },
    async read(start, end) {
      const data = new Uint8Array(end - start)
      for (let offset = start; offset < end; offset += maxRangeSize) {
        const limit = Math.min(offset + maxRangeSize, end)
        const { headers, bytes } = await readMedia(source, offset, limit, signal)
        const reported = /^content-range:\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/mi.exec(headers)
        if (Number(reported?.[1]) !== offset || Number(reported?.[2]) !== limit - 1 || Number(reported?.[3]) !== size) {
          throw new Error('The file server returned a different byte range.')
        }
        data.set(new Uint8Array(bytes), offset - start)
      }
      return data
    }
  }
}

function playDecodedAudio(video, sink, context, signal, failed) {
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
  void start()
}
