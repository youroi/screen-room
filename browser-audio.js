const audioPackage = 'https://cdn.jsdelivr.net/npm/'
const maxRangeSize = 512 * 1024
const readsPerBatch = 2
const headerSize = 128 * 1024
const initialAudioBuffer = 0.4
const refillAudioBuffer = 2.5
const audioReadAhead = 4
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
  const via = readMedia && viaSource(source, readMedia, signal)
  const [bunny, range] = await Promise.all([
    import(audioPackage + 'mediabunny@1.66.0/+esm'), via ? via.getSize().then(() => null) : checkRange()
  ])
  signal.throwIfAborted()
  if (!readMedia && !(range.status === 206 && range.range)) {
    if (range.ignored) throw new Error('The file server does not support byte ranges.')
    throw new Error('Open Player setup from the title page to install the Via script.')
  }
  const { Input, MATROSKA, UrlSource, CustomSource, AudioBufferSink } = bunny
  const createInput = () => new Input({
    formats: [MATROSKA],
    source: via ? new CustomSource(via) : new UrlSource(source, {
      requestInit: { credentials: 'omit', redirect: 'error' }, maxCacheSize: 16 * 1024 * 1024
    })
  })
  let input = createInput()
  signal.addEventListener('abort', () => input.dispose(), { once: true })
  try {
    const [tracks, primary] = await Promise.all([input.getAudioTracks(), input.getPrimaryAudioTrack()])
    const choices = orderAudioTracks(await Promise.all(tracks.map(async (track, index) => {
      const [codec, name, language, disposition] = await Promise.all([
        track.getCodec(), track.getName(), track.getLanguageCode(), track.getDisposition()
      ])
      return { index, codec, name, language, disposition, primary: track === primary }
    })))
    signal.throwIfAborted()
    return {
      choices,
      async decoder(choice) {
        await prepareDecoder(choice.codec, bunny)
        signal.throwIfAborted()
        const track = (await input.getAudioTracks())[choice.index]
        if (!(await track?.canDecode())) return null
        return {
          restart() {
            // Dispose the prefetch workers so a distant seek does not queue behind the old ranges.
            input.dispose()
            input = createInput()
          },
          async *buffers(position) {
            const current = input
            const currentTrack = (await current.getAudioTracks())[choice.index]
            yield* new AudioBufferSink(currentTrack).buffers(position)
          }
        }
      }
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}

export function viaSource(source, readMedia, signal) {
  let size
  let header

  async function readRange(start, end, requestSignal = signal) {
    const { headers, bytes } = await readMedia(source, start, end, requestSignal)
    const reported = /^content-range:\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/mi.exec(headers)
    const total = Number(reported?.[3])
    if (Number(reported?.[1]) !== start || Number(reported?.[2]) !== end - 1 ||
        !Number.isSafeInteger(total) || total < end || (size !== undefined && total !== size)) {
      throw new Error('The file server returned a different byte range.')
    }
    size = total
    const data = new Uint8Array(bytes)
    if (header?.length === start && end <= maxRangeSize) {
      const prefix = new Uint8Array(end)
      prefix.set(header)
      prefix.set(data, start)
      header = prefix
    }
    return data
  }

  async function* readChunks(start, end, requestSignal) {
    const cachedEnd = Math.min(header?.length ?? 0, end)
    if (start < cachedEnd) yield header.subarray(start, cachedEnd)
    for (let base = Math.max(start, cachedEnd); base < end; base += readsPerBatch * maxRangeSize) {
      requestSignal.throwIfAborted()
      const count = Math.min(readsPerBatch, Math.ceil((end - base) / maxRangeSize))
      const batch = Array.from({ length: count }, (_, index) => {
        const offset = base + index * maxRangeSize
        const request = readRange(offset, Math.min(offset + maxRangeSize, end), requestSignal)
        void request.catch(() => {})
        return request
      })
      // Give the parser the first range without waiting for speculative ranges to finish.
      for (const request of batch) yield await request
    }
  }

  return {
    prefetchProfile: 'network', maxCacheSize: 8 * 1024 * 1024,
    async getSize() {
      if (size === undefined) {
        // The first range provides both the file size and the MKV headers.
        try {
          header = await readRange(0, headerSize)
        } catch (error) {
          signal.throwIfAborted()
          if (!/incomplete byte range|different byte range/.test(error.message)) throw error
          await readRange(0, 1)
        }
      }
      return size
    },
    read(start, end) {
      const controller = new AbortController()
      const chunks = readChunks(start, end, AbortSignal.any([signal, controller.signal]))
      return new ReadableStream({
        async pull(stream) {
          try {
            const { done, value } = await chunks.next()
            if (controller.signal.aborted) return
            if (done) stream.close()
            else stream.enqueue(value)
          } catch (error) {
            if (controller.signal.aborted) return
            controller.abort()
            stream.error(error)
          }
        },
        cancel() {
          controller.abort()
          void chunks.return().catch(() => {})
        }
      })
    }
  }
}

function readBuffers(sink, position) {
  return { position, end: position, buffers: sink.buffers(position), entries: [] }
}

async function fillAudio(job, until) {
  while (!job.done && !job.closed && job.end < until) {
    if (job.error) throw job.error
    job.pending ??= job.buffers.next().then(({ done, value }) => {
      if (done) job.done = true
      else if (!job.closed) {
        job.entries.push(value)
        job.end = Math.max(job.end, value.timestamp + value.buffer.duration)
      }
    }).catch(error => {
      job.error = error
      throw error
    }).finally(() => { job.pending = undefined })
    await job.pending
  }
}

function release(job) {
  if (!job) return
  job.closed = true
  job.entries.length = 0
  void job.buffers.return().catch(() => {})
}

export function warmAudioStart(sink, signal) {
  if (signal.aborted) return
  const warm = readBuffers(sink, 0)
  void fillAudio(warm, initialAudioBuffer).catch(() => {})
  warmStarts.set(sink, warm)
  signal.addEventListener('abort', () => {
    if (warmStarts.delete(sink)) release(warm)
  }, { once: true })
}

export function playDecodedAudio(video, sink, context, signal, { volume, started, starved, failed }) {
  const gain = context.createGain()
  gain.connect(context.destination)
  const scheduled = new Set()
  let job = warmStarts.get(sink)
  let playback
  let timer
  let level = volume
  warmStarts.delete(sink)

  function stop() {
    clearInterval(timer)
    playback = undefined
    for (const source of scheduled) source.stop()
    scheduled.clear()
  }

  function reset() {
    stop()
    release(job)
    job = undefined
  }

  function prime(position, restartReader = false) {
    reset()
    if (restartReader) sink.restart()
    job = readBuffers(sink, position)
    void fillAudio(job, position + initialAudioBuffer * video.playbackRate).catch(() => {})
  }

  function bufferAt(position) {
    if (!job || position < job.position - 0.06 || position > job.end + 0.3) prime(position)
    return job
  }

  async function ready(position) {
    const current = bufferAt(position)
    try {
      const lead = current.refilling ? refillAudioBuffer : initialAudioBuffer
      await fillAudio(current, position + lead * video.playbackRate)
      if (job !== current || signal.aborted) return false
      current.refilling = false
      if (current.entries.length || position >= video.duration - 1) return true
      failed(new Error('No audio samples at this position.'))
    } catch (error) {
      if (job === current && !signal.aborted) failed(error)
    }
    return false
  }

  function start() {
    if (playback || video.paused || video.seeking || video.readyState < 3 || signal.aborted) return
    const position = video.currentTime
    const current = bufferAt(position)
    const rate = video.playbackRate
    const clock = context.currentTime
    let lastTimestamp = -Infinity
    let playing = false
    playback = current
    timer = setInterval(pump, 40)
    pump()

    function pump() {
      if (playback !== current || video.paused || video.seeking) return
      const now = video.currentTime
      while (current.entries[0] && current.entries[0].timestamp + current.entries[0].buffer.duration < now - 0.15) {
        const { buffer, timestamp } = current.entries.shift()
        current.position = Math.max(current.position, timestamp + buffer.duration)
      }
      if (!current.filling && !current.done) {
        current.filling = true
        void fillAudio(current, now + audioReadAhead * rate).catch(error => {
          if (job === current && !signal.aborted) failed(error)
        }).finally(() => { current.filling = false })
      }
      if (level > 0 && !current.done && current.end < now + 0.12 * rate) {
        current.refilling = true
        starved()
        return
      }
      try {
        for (const { buffer, timestamp } of current.entries) {
          if (timestamp <= lastTimestamp) continue
          if (timestamp > now + 0.75 * rate) break
          lastTimestamp = timestamp
          const when = clock + (timestamp - position) / rate
          const skip = Math.max(0, (context.currentTime - when) * rate)
          if (skip >= buffer.duration) continue
          const source = context.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = rate
          source.connect(gain)
          source.onended = () => { scheduled.delete(source); source.disconnect() }
          source.start(Math.max(when, context.currentTime), skip)
          scheduled.add(source)
          if (!playing) started()
          playing = true
        }
      } catch (error) {
        if (!signal.aborted) failed(error)
      }
    }
  }

  for (const event of ['playing', 'seeked']) video.addEventListener(event, start, { signal })
  video.addEventListener('ratechange', () => { stop(); start() }, { signal })
  // Keep decoded audio during a pause so buffering does not reopen the reader.
  for (const event of ['pause', 'seeking', 'waiting', 'ended']) video.addEventListener(event, stop, { signal })
  signal.addEventListener('abort', () => {
    reset()
    gain.disconnect()
  }, { once: true })
  gain.gain.value = volume
  function setVolume(value) {
    level = value
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setTargetAtTime(value, context.currentTime, 0.012)
  }
  if (!job) prime(video.currentTime)
  start()
  return { prime, ready, reset, setVolume }
}
