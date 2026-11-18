export const pagesOrigin = 'https://youroi.github.io'
export const defaultBridge = 'http://127.0.0.1:4174'

export function addressSpace(hostname) {
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') return 'loopback'
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d/.test(hostname) &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return 'local'
  return null
}

export function parseBridge(value) {
  const input = value.trim()
  const url = URL.parse(input.includes('://') ? input : 'http://' + input)
  if (!url || url.protocol !== 'http:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !addressSpace(url.hostname)) return null
  if (!url.port) url.port = '4174'
  return url
}

export function bridgeFetch(bridge, path, signal) {
  return fetch(new URL(path, bridge), {
    credentials: 'omit', redirect: 'error', signal, targetAddressSpace: addressSpace(bridge.hostname)
  })
}
