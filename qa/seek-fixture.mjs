import { createServer } from 'node:http'
import { statSync, createReadStream } from 'node:fs'
import { createApp } from '../server.mjs'

if (!process.argv[2]) throw new Error('Pass a seekable MP4 test clip as an argument.')
const video = process.argv[2]
const size = statSync(video).size
let mode = 'normal'
let trace = []
let failures = 0

const feed = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path.startsWith('/mode/')) {
    mode = path.slice(6)
    trace = []
    failures = 0
    return res.end(mode)
  }
  if (path === '/trace') return res.end(JSON.stringify({ mode, trace, failures }))
  if (path !== '/video.mp4') return res.writeHead(404).end()
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  const start = Number(range?.[1] ?? 0)
  const end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1
  const headers = { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }
  if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size
  trace.push(start)
  res.writeHead(range ? 206 : 200, headers)
  res.flushHeaders()

  if (mode === 'persistent' || (mode === 'recover' && !failures)) {
    if (start >= 350000) {
      failures++
      return
    }
    const media = createReadStream(video, { start, end: Math.min(end, 350000) })
    res.once('close', () => media.destroy())
    return media.pipe(res, { end: end <= 350000 })
  }

  const media = createReadStream(video, { start, end })
  res.once('close', () => media.destroy())
  return media.pipe(res)
})
feed.listen(4192, '127.0.0.1')
const app = createApp({
  resolve: async () => new URL('http://127.0.0.1:4192/video.mp4'),
  openVideo(url, { signal, method, range }) {
    return fetch(url, { signal, method, headers: range ? { Range: range } : {} })
  }
})
app.listen(4184, '127.0.0.1', () => console.log('Screen Room seek fixture ready'))
