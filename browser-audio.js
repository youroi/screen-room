const audioPackage = 'https://cdn.jsdelivr.net/npm/'
const maxRangeSize = 512 * 1024
const decoderLoads = new Map()
const warmStarts = new WeakMap()

export function orderAudioTracks(tracks) {
  return [...tracks].sort((a, b) => rank(a) - rank(b))

  function rank(track) {
    if (track.disposition.commentary || track.disposition.visuallyImpaired) return 5
    if (/^(?:hi|hin)(?:[-_]|$)/i.test(track.language) || /\bHindi\b|हिंदी|हिन्दी/i.test(track.name ?? '')) return 0
    if (track.disposition.original) return 1
    if (track.primary) return 2
    if (track.disposition.default) return 3
    return 4
  }
}

async function prepareDecoder(codec, bunny) {
  const key = codec === 'eac3' ? 'ac3' : codec
  const extensions = {
    ac3: 'registerAc3Decoder', dts: 'registerDtsDecoder', truehd: 'registerTrueHdDecoder'
  }
  if (key !== 'aac' && !Object.hasOwn(extensions, key)) return
  if (!decoderLoads.has(key)) {
    const load = key === 'aac' ? registerAacDecoder(bunny) :
      import(audioPackage + '@mediabunny/' + key + '@1.66.1/+esm').then(module => module[extensions[key]]())
    decoderLoads.set(key, load.catch(error => {
      decoderLoads.delete(key)
      throw error
    }))
  }
  return decoderLoads.get(key)
}

async function registerAacDecoder({ registerDecoder, CustomAudioDecoder, AudioSample }) {
  const { AACDecoder } = await import(audioPackage + '@wasm-audio-decoders/aac@0.0.1/+esm')
  registerDecoder(class extends CustomAudioDecoder {
    static supports(codec, config) {
      return codec === 'aac' && Boolean(config.description?.byteLength)
    }

    async init() {
      const description = this.config.description
      const audioSpecificConfig = ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
        : new Uint8Array(description)
      this.decoder = new AACDecoder({ audioSpecificConfig })
      await this.decoder.ready
    }

    async decode(packet) {
      const { channelData, samplesDecoded, sampleRate, errors } = await this.decoder.decodeFrames([packet.data])
      if (errors.length) throw new Error(errors[0].message)
      if (!samplesDecoded) return
      const order = channelData.length === 6 ? [0, 2, 1, 5, 3, 4] : channelData.map((_, index) => index)
      const data = new Float32Array(samplesDecoded * order.length)
      order.forEach((channel, index) => data.set(channelData[channel], index * samplesDecoded))
      this.onSample(new AudioSample({
        data, format: 'f32-planar', numberOfChannels: order.length, sampleRate, timestamp: packet.timestamp
      }))
    }

    flush() {}
    close() { this.decoder?.free() }
  })
}

export async function openBrowserAudio(source, checkRange, signal) {
  const readMedia = window.screenRoomReadMedia
  const [bunny, range] = await Promise.all([
    import(audioPackage + 'mediabunny@1.66.0/+esm'), readMedia ? null : checkRange()
  ])
  signal.throwIfAborted()
  if (!readMedia && !(range.status === 206 && range.range)) {
    if (range.ignored) throw new Error('The file server does not support byte ranges.')
    throw new Error('Install the Screen Room script from Circle web player setup in Via.')
  }
  const { Input, MATROSKA, UrlSource, CustomSource, AudioBufferSink } = bunny
  const data = readMedia ? new CustomSource(viaSource(source, readMedia, signal)) :
    new UrlSource(source, {
      requestInit: { credentials: 'omit', redirect: 'error' }, maxCacheSize: 16 * 1024 * 1024
    })
  const input = new Input({ formats: [MATROSKA], source: data })
  signal.addEventListener('abort', () => input.dispose(), { once: true })
  try {
    const [tracks, primary] = await Promise.all([input.getAudioTracks(), input.getPrimaryAudioTrack()])
    const choices = orderAudioTracks(await Promise.all(tracks.map(async (track, index) => {
      const [codec, name, language, disposition] = await Promise.all([
        track.getCodec(), track.getName(), track.getLanguageCode(), track.getDisposition()
      ])
      return { track, index, codec, name, language, disposition, primary: track === primary }
    })))
    signal.throwIfAborted()
    return {
      choices,
      async decoder(choice) {
        await prepareDecoder(choice.codec, bunny)
        signal.throwIfAborted()
        return await choice.track.canDecode() ? new AudioBufferSink(choice.track) : null
      }
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}

export function viaSource(source, readMedia, signal) {
  let size

  async function readRange(start, end) {
    const { headers, bytes } = await readMedia(source, start, end, signal)
    const reported = /^content-range:\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/mi.exec(headers)
    const total = Number(reported?.[3])
    if (Number(reported?.[1]) !== start || Number(reported?.[2]) !== end - 1 ||
        !Number.isSafeInteger(total) || total < end || (size !== undefined && total !== size)) {
      throw new Error('The file server returned a different byte range.')
    }
    size = total
    return new Uint8Array(bytes)
  }

  return {
    prefetchProfile: 'fileSystem', maxCacheSize: 8 * 1024 * 1024,
    async getSize() {
      // A successful range provides the file size even when the server rejects HEAD.
      await readRange(0, 1)
      return size
    },
    async read(start, end) {
      const data = new Uint8Array(end - start)
      for (let offset = start; offset < end; offset += maxRangeSize) {
        const limit = Math.min(offset + maxRangeSize, end)
        data.set(await readRange(offset, limit), offset - start)
      }
      return data
    }
  }
}

function readBuffers(sink, position) {
  const buffers = sink.buffers(Math.max(0, position - 0.06))
  const first = buffers.next()
  void first.catch(() => {})
  return { position, buffers, first }
}

function release(job) {
  if (job) void job.buffers.return().catch(() => {})
}

export function warmAudioStart(sink, signal) {
  if (signal.aborted) return
  const warm = readBuffers(sink, 0)
  warmStarts.set(sink, warm)
  signal.addEventListener('abort', () => {
    if (warmStarts.delete(sink)) release(warm)
  }, { once: true })
}

export function playDecodedAudio(video, sink, context, signal, { volume, started, failed }) {
  const gain = context.createGain()
  gain.connect(context.destination)
  const scheduled = new Set()
  let active
  let prepared = warmStarts.get(sink)
  warmStarts.delete(sink)

  function stop() {
    release(active)
    active = undefined
    for (const source of scheduled) source.stop()
    scheduled.clear()
  }

  function reset() {
    stop()
    release(prepared)
    prepared = undefined
  }

  function prime(position) {
    reset()
    prepared = readBuffers(sink, position)
  }

  async function start() {
    if (active || video.paused || video.seeking || video.readyState < 3 || signal.aborted) return
    const position = video.currentTime
    if (prepared && Math.abs(prepared.position - position) > 0.65) {
      release(prepared)
      prepared = undefined
    }
    const job = prepared ?? readBuffers(sink, position)
    prepared = undefined
    active = job
    const clock = context.currentTime
    const rate = video.playbackRate
    try {
      let next = await job.first
      let playing = false
      while (!next.done) {
        const { buffer, timestamp } = next.value
        while (active === job && timestamp > video.currentTime + 1) {
          await new Promise(resolve => setTimeout(resolve, 75))
        }
        if (active !== job) return
        const when = clock + (timestamp - position) / rate
        const skip = Math.max(0, (context.currentTime - when) * rate)
        if (skip < buffer.duration) {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = rate
          source.connect(gain)
          scheduled.add(source)
          source.onended = () => { scheduled.delete(source); source.disconnect() }
          source.start(Math.max(when, context.currentTime), skip)
          if (!playing) started()
          playing = true
        }
        next = await job.buffers.next()
      }
      if (active === job && !playing && position < video.duration - 1) failed(new Error('No audio samples at this position.'))
    } catch (error) {
      if (active === job) failed(error)
    }
  }

  for (const event of ['playing', 'seeked']) video.addEventListener(event, start, { signal })
  video.addEventListener('ratechange', () => { stop(); void start() }, { signal })
  for (const event of ['pause', 'seeking', 'waiting', 'ended']) video.addEventListener(event, stop, { signal })
  signal.addEventListener('abort', () => {
    reset()
    gain.disconnect()
  }, { once: true })
  const setVolume = value => { gain.gain.value = value }
  setVolume(volume)
  if (!prepared) prime(video.currentTime)
  void start()
  return { prime, reset, setVolume }
}
