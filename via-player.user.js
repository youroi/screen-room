// ==UserScript==
// @name         Screen Room Player for Via
// @namespace    https://youroi.github.io/screen-room/
// @version      1.0.1
// @description  Open Screen Room on the Circle tab and read the playing MKV for browser audio.
// @match        http://new.circleftp.net:5000/api/posts*
// @match        http://15.1.1.50:5000/api/posts*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
  const page = new URL(location.href)
  if (page.pathname !== '/api/posts' || page.searchParams.get('searchTerm') !== 'screen-room-browser') return
  if (!['http://new.circleftp.net:5000', 'http://15.1.1.50:5000'].includes(page.origin)) return

  window.screenRoomReadMedia = async (source, start, end, signal) => {
    const url = new URL(source)
    const current = document.querySelector('.player video')?.currentSrc
    if (current !== url.href || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
        !/\.mkv$/i.test(url.pathname) || !['', '80', '443', '5000', '8080', '8096'].includes(url.port) ||
        !(/(?:^|\.)circleftp\.net$/.test(url.hostname) ||
          ['15.1.1.1', '15.1.1.4', '15.1.1.5', '15.1.1.50', '103.170.204.84'].includes(url.hostname))) {
      throw new Error('The current video is not an approved Circle MKV.')
    }
    const head = start === undefined && end === undefined
    if (!head && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
        end <= start || end - start > 524288)) throw new Error('Invalid media range.')
    signal.throwIfAborted()

    return new Promise((resolve, reject) => {
      let request
      let settled = false
      const expected = head ? 200 : 206
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        callback(value)
      }
      const fail = message => {
        finish(reject, new Error(message))
        request?.abort?.()
      }
      const cancel = () => fail('Media read canceled.')
      const timer = setTimeout(() => fail('The file server stopped responding.'), 7000)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        request = GM_xmlhttpRequest({
          method: head ? 'HEAD' : 'GET', url: url.href, anonymous: true, timeout: 7000,
          headers: head ? {} : { Range: 'bytes=' + start + '-' + (end - 1) }, responseType: 'arraybuffer',
          onreadystatechange(response) {
            if (response.readyState >= 2 && response.status && response.status !== expected) {
              fail('The file server rejected the media read.')
            }
          },
          onprogress(response) {
            if (!head && response.loaded > end - start) fail('The file server ignored the byte range.')
          },
          onload(response) {
            if (response.status !== expected || (response.finalUrl && response.finalUrl !== url.href)) {
              return fail('The file server rejected the media read.')
            }
            const bytes = response.response
            if (!head && (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== end - start)) {
              return fail('The file server returned an incomplete byte range.')
            }
            finish(resolve, { headers: response.responseHeaders, bytes })
          },
          onerror() { fail('The file server could not be reached.') },
          ontimeout() { fail('The file server stopped responding.') }
        })
      } catch (error) {
        finish(reject, error)
      }
    })
  }

  if (document.querySelector('script[data-screen-room]')) return
  const launcher = document.createElement('script')
  launcher.type = 'module'
  launcher.dataset.screenRoom = '1'
  launcher.src = 'https://youroi.github.io/screen-room/circle-web.js?v=3'
  launcher.onerror = () => { launcher.remove(); alert('Screen Room could not load in this tab.') }
  document.head.append(launcher)
})()
