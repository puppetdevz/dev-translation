'use strict'

const http = require('http')
const https = require('https')
const tls = require('tls')

const DEFAULT_GOOGLE_HOSTS = [
  'translate.googleapis.com',
  'clients5.google.com',
  'translate.google.com',
]

let extraAllowedHosts = []

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const DURATION_BUCKET_MS = 50
const DURATION_MAX_MS = 60000

function setAllowedGoogleHostsForTest(hosts) {
  extraAllowedHosts = Array.isArray(hosts) ? hosts.slice() : []
}

function restoreAllowedGoogleHosts() {
  extraAllowedHosts = []
}

function isAllowedGoogleHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false
  if (DEFAULT_GOOGLE_HOSTS.includes(host)) return true
  if (host.startsWith('translate.google.')) return true
  return extraAllowedHosts.some((item) => String(item || '').toLowerCase() === host)
}

function parseGoogleProxyUrl(raw) {
  const trimmed = raw == null ? '' : String(raw).trim()
  if (!trimmed) return { ok: false, reason: 'empty', url: '' }
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'malformed', url: trimmed }
  }
  const protocol = String(parsed.protocol || '').toLowerCase()
  if (protocol === 'socks:' || protocol === 'socks4:' || protocol === 'socks5:') {
    return { ok: false, reason: 'protocol', url: trimmed }
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, reason: 'protocol', url: trimmed }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials', url: trimmed }
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'malformed', url: trimmed }
  }
  const port = parsed.port
  return {
    ok: true,
    reason: '',
    url: `${protocol}//${parsed.hostname}${port ? ':' + port : ''}`,
    protocol,
    hostname: parsed.hostname,
    port: port ? Number(port) : (protocol === 'https:' ? 443 : 80),
  }
}

function resolveProxyUrl(opts) {
  if (!opts || !opts.proxyEnabled) return ''
  const parsed = parseGoogleProxyUrl(opts.proxyUrl)
  return parsed.ok ? parsed.url : ''
}

function googleRouteKey(opts) {
  const url = resolveProxyUrl(opts)
  return url ? `proxy:${url}` : 'direct'
}

function sliceSourceBudget(remaining, sourcesLeft) {
  const left = Number(remaining)
  const count = Number(sourcesLeft)
  if (!Number.isFinite(left) || left <= 0) return 0
  if (!Number.isFinite(count) || count <= 1) return left
  const reserve = Math.max(1, Math.floor(left * (count - 1) / count))
  const cap = left - reserve
  return cap > 0 ? cap : left
}

function proxyPhaseBudget(totalMs) {
  const total = Number(totalMs)
  if (!Number.isFinite(total) || total <= 0) return { proxyCap: 0, directReserve: 0 }
  const directReserve = Math.max(1, Math.floor(total * 2 / 5))
  const proxyCap = Math.max(1, total - directReserve)
  return { proxyCap, directReserve }
}

function coarseDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(DURATION_MAX_MS, Math.round(n / DURATION_BUCKET_MS) * DURATION_BUCKET_MS)
}

function pickStatus(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 100 || n > 599) return null
  return n
}

function classifyGoogleSourceError(err) {
  if (!err) return { category: 'unknown', statusCode: null }
  const tagged = err.category
  if (
    tagged === 'proxy_connect'
    || tagged === 'network_error'
    || tagged === 'timeout'
    || tagged === 'http_error'
    || tagged === 'parse_error'
    || tagged === 'empty_result'
    || tagged === 'library_missing'
  ) {
    return { category: tagged, statusCode: pickStatus(err.statusCode) }
  }
  const status = pickStatus(err.statusCode || err.status)
  const msg = err.message != null ? String(err.message) : String(err)
  if (status === 429) return { category: 'http_error', statusCode: 429 }
  if (status) return { category: 'http_error', statusCode: status }
  if (/超时|timeout|aborted/i.test(msg)) return { category: 'timeout', statusCode: null }
  if (/解析失败|格式异常/.test(msg)) return { category: 'parse_error', statusCode: null }
  if (/空结果/.test(msg)) return { category: 'empty_result', statusCode: null }
  if (/库不可用/.test(msg)) return { category: 'library_missing', statusCode: null }
  if (/代理连接失败|ECONNREFUSED/i.test(msg)) return { category: 'proxy_connect', statusCode: null }
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|EHOSTUNREACH|socket hang up|network/i.test(msg)) {
    return { category: 'network_error', statusCode: null }
  }
  return { category: 'unknown', statusCode: null }
}

function normalizeHeaders(headers) {
  const out = {}
  if (!headers) return out
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      if (key) out[key] = value
    })
    return out
  }
  Object.keys(headers).forEach((key) => {
    if (key) out[key] = headers[key]
  })
  return out
}

function bodyToBuffer(body) {
  if (body == null || body === '') return null
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (typeof body.toString === 'function') return Buffer.from(String(body))
  return null
}

function collectHttpResponse(res, onFail) {
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      if (typeof onFail === 'function') onFail(err, res && res.statusCode)
      else reject(err)
    }
    const chunks = []
    let size = 0
    res.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error('响应解析失败'), { category: 'parse_error' }))
        try { res.destroy() } catch (e) { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    res.on('error', (err) => fail(err))
    res.on('end', () => {
      resolve({
        statusCode: res.statusCode || 0,
        statusMessage: res.statusMessage || '',
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })
}

function attachAbort(signal, onAbort) {
  if (!signal || typeof signal.addEventListener !== 'function') return () => {}
  if (signal.aborted) {
    onAbort()
    return () => {}
  }
  signal.addEventListener('abort', onAbort)
  return () => {
    if (typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function googleHttpRequest(opts) {
  const options = opts && typeof opts === 'object' ? opts : {}
  return new Promise((resolve, reject) => {
    let urlObj
    try {
      urlObj = new URL(options.url)
    } catch {
      reject(new Error('请求地址无效'))
      return
    }
    if (urlObj.protocol !== 'https:') {
      reject(Object.assign(new Error('目标主机不允许'), { category: 'network_error' }))
      return
    }
    if (!isAllowedGoogleHost(urlObj.hostname)) {
      reject(Object.assign(new Error('目标主机不允许'), { category: 'network_error' }))
      return
    }

    const timeoutMs = Number(options.timeoutMs)
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
    const signal = options.signal
    if ((signal && signal.aborted) || ms <= 0) {
      reject(Object.assign(new Error('请求超时'), { category: 'timeout' }))
      return
    }

    const method = String(options.method || 'GET').toUpperCase()
    const headers = normalizeHeaders(options.headers)
    if (!headers['User-Agent'] && !headers['user-agent']) headers['User-Agent'] = BROWSER_UA
    const bodyBuf = bodyToBuffer(options.body)
    if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = String(bodyBuf.length)
    }

    const proxyParsed = options.proxyUrl ? parseGoogleProxyUrl(options.proxyUrl) : { ok: false }
    const useProxy = !!(proxyParsed && proxyParsed.ok)

    let settled = false
    let timer = null
    let proxyReq = null
    let tlsSocket = null
    let req = null
    let detachAbort = () => {}

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      detachAbort()
    }

    const destroyAll = () => {
      if (req) {
        try { req.destroy() } catch (e) { /* ignore */ }
      }
      if (tlsSocket) {
        try { tlsSocket.destroy() } catch (e) { /* ignore */ }
      }
      if (proxyReq) {
        try { proxyReq.destroy() } catch (e) { /* ignore */ }
      }
    }

    const fail = (err, category) => {
      if (settled) return
      settled = true
      cleanup()
      destroyAll()
      if (err && typeof err === 'object' && category && err.category == null) {
        err.category = category
      }
      reject(err)
    }

    const succeed = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    timer = setTimeout(() => {
      fail(new Error('请求超时'), 'timeout')
    }, ms)

    detachAbort = attachAbort(signal, () => fail(new Error('请求超时'), 'timeout'))

    const startHttpsRequest = (createConnection) => {
      const reqOpts = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        timeout: ms,
        servername: urlObj.hostname,
      }
      if (typeof createConnection === 'function') {
        reqOpts.createConnection = createConnection
      }
      req = https.request(reqOpts, (res) => {
        collectHttpResponse(res, (err) => fail(err, 'network_error')).then(succeed, (err) => {
          fail(err, 'network_error')
        })
      })
      req.on('error', (err) => {
        fail(err, useProxy ? 'proxy_connect' : 'network_error')
      })
      req.on('timeout', () => fail(new Error('请求超时'), 'timeout'))
      if (bodyBuf) req.write(bodyBuf)
      req.end()
    }

    if (!useProxy) {
      startHttpsRequest()
      return
    }

    const connectPath = `${urlObj.hostname}:${urlObj.port || 443}`
    const connectOpts = {
      host: proxyParsed.hostname,
      port: proxyParsed.port,
      method: 'CONNECT',
      path: connectPath,
      headers: {
        Host: connectPath,
        'Proxy-Connection': 'keep-alive',
      },
      timeout: ms,
    }
    const proxyTransport = proxyParsed.protocol === 'https:' ? https : http
    proxyReq = proxyTransport.request(connectOpts)
    proxyReq.on('connect', (res, socket, head) => {
      if (settled) {
        try { socket.destroy() } catch (e) { /* ignore */ }
        return
      }
      if (!res || res.statusCode !== 200) {
        const err = new Error('代理连接失败')
        const code = pickStatus(res && res.statusCode)
        if (code) err.statusCode = code
        try { socket.destroy() } catch (e) { /* ignore */ }
        fail(err, 'proxy_connect')
        return
      }
      const tlsOpts = {
        socket,
        servername: urlObj.hostname,
      }
      tlsSocket = tls.connect(tlsOpts, () => {
        if (settled) return
        startHttpsRequest((_opts, cb) => {
          if (typeof cb === 'function') cb(null, tlsSocket)
          return tlsSocket
        })
      })
      if (head && head.length) {
        try { tlsSocket.unshift(head) } catch (e) { /* ignore */ }
      }
      tlsSocket.on('error', (err) => fail(err, 'network_error'))
    })
    proxyReq.on('error', (err) => fail(err, 'proxy_connect'))
    proxyReq.on('timeout', () => fail(new Error('请求超时'), 'timeout'))
    proxyReq.end()
  })
}

function createLibraryRequestFunction({ proxyUrl, timeoutMs, signal } = {}) {
  return function googleLibraryRequest(url, init) {
    const requestInit = init && typeof init === 'object' ? init : {}
    const parentSignal = signal
    const childSignal = requestInit.signal
    const aborted = (parentSignal && parentSignal.aborted) || (childSignal && childSignal.aborted)
    if (aborted) {
      return Promise.reject(Object.assign(new Error('请求超时'), { category: 'timeout' }))
    }
    return googleHttpRequest({
      url,
      method: requestInit.method || 'GET',
      headers: requestInit.headers,
      body: requestInit.body,
      timeoutMs,
      signal: childSignal || parentSignal,
      proxyUrl,
    }).then((res) => ({
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      statusText: res.statusMessage || '',
      headers: res.headers,
      text: async () => res.body,
      json: async () => JSON.parse(res.body),
    }))
  }
}

module.exports = {
  BROWSER_UA,
  parseGoogleProxyUrl,
  resolveProxyUrl,
  googleRouteKey,
  sliceSourceBudget,
  proxyPhaseBudget,
  coarseDuration,
  classifyGoogleSourceError,
  isAllowedGoogleHost,
  setAllowedGoogleHostsForTest,
  restoreAllowedGoogleHosts,
  googleHttpRequest,
  createLibraryRequestFunction,
}
