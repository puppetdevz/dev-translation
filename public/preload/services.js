const fs = require('node:fs')
const path = require('node:path')
const https = require('https')
const http = require('http')
const {
  parseGoogleProxyUrl,
  resolveProxyUrl,
  googleRouteKey,
  sliceSourceBudget,
  proxyPhaseBudget,
  coarseDuration,
  classifyGoogleSourceError,
  googleHttpRequest,
  createLibraryRequestFunction,
  setAllowedGoogleHostsForTest,
  restoreAllowedGoogleHosts,
} = require('./googleTransport')
const {
  translateWithBaidu,
  translateWithAliyun,
  translateWithCaiyun,
} = require('./officialEngines')

// google-translate-api-x 为可选源：安装包若未带上该依赖，不得阻断整个 window.services 初始化。
let googleLibrary = null
let googleLibraryTried = false
function getGoogleLibrary () {
  if (googleLibraryTried) return googleLibrary
  googleLibraryTried = true
  try {
    googleLibrary = require('google-translate-api-x')
  } catch (e) {
    googleLibrary = null
  }
  return googleLibrary
}

const EMPTY_DICT_RESULT = { phonetic: '', definitions: [], examples: [] }

// ===== LRU 缓存（避免重复请求，降低限流概率） =====
const CACHE_MAX = 200
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 小时
const translateCache = new Map() // key: from|to|text -> { value, expireAt }
// inflight 去重：key -> Promise，并发同 key 共享单次请求，避免双 miss 击穿缓存与限流
const inflightRequests = new Map()

function getCache (key) {
  if (!translateCache.has(key)) return null
  const entry = translateCache.get(key)
  if (Date.now() > entry.expireAt) {
    translateCache.delete(key)
    return null
  }
  // LRU: 命中后移到末尾（最近使用）
  translateCache.delete(key)
  translateCache.set(key, entry)
  return entry.value
}

function setCache (key, value) {
  if (translateCache.size >= CACHE_MAX) {
    // 删除最老的（Map 迭代顺序中第一个）
    const firstKey = translateCache.keys().next().value
    translateCache.delete(firstKey)
  }
  translateCache.set(key, { value, expireAt: Date.now() + CACHE_TTL })
}

// ===== 通用超时与 UA 常量 =====
const TIMEOUT_MS = 5000
const THIRDPARTY_AI_TIMEOUT_MS = 30000
const LOOKUP_TIMEOUT_MS = 5000
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function resolvePositiveTimeout(timeoutMs, fallback) {
  const n = Number(timeoutMs)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function createAbortController() {
  if (typeof AbortController === 'function') return new AbortController()
  const listeners = []
  const controller = {
    aborted: false,
    signal: {
      get aborted() { return controller.aborted },
      addEventListener(type, fn) {
        if (type === 'abort' && typeof fn === 'function') listeners.push(fn)
      },
      removeEventListener(type, fn) {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      },
    },
    abort() {
      if (controller.aborted) return
      controller.aborted = true
      for (const fn of listeners.slice()) {
        try { fn() } catch (e) { /* ignore */ }
      }
    },
  }
  return controller
}

/** 只把状态码附到 Error 上，不附 URL/请求体/响应正文/凭据 */
function attachStatus (err, statusCode) {
  if (!err || typeof err !== 'object') return err
  const code = Number(statusCode)
  if (Number.isFinite(code) && code >= 100 && code <= 599 && err.statusCode == null) {
    err.statusCode = code
  }
  return err
}

function httpStatusError (statusCode) {
  const e = new Error('HTTP ' + statusCode)
  attachStatus(e, statusCode)
  e.category = 'http_error'
  return e
}

function timeoutError () {
  const e = new Error('请求超时')
  e.category = 'timeout'
  return e
}

// ===== Google HTTPS GET JSON（可选 CONNECT 代理；错误不含 URL/正文） =====
function httpsGetJson (url, extraHeaders, timeoutMs = TIMEOUT_MS, signal, proxyUrl) {
  const ms = resolvePositiveTimeout(timeoutMs, TIMEOUT_MS)
  if ((signal && signal.aborted) || ms <= 0) {
    return Promise.reject(timeoutError())
  }
  return googleHttpRequest({
    url,
    method: 'GET',
    headers: Object.assign({
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json, text/plain, */*'
    }, extraHeaders || {}),
    timeoutMs: ms,
    signal,
    proxyUrl,
  }).then((res) => {
    if (res.statusCode && res.statusCode >= 400) {
      throw httpStatusError(res.statusCode)
    }
    try {
      return JSON.parse(res.body)
    } catch (err) {
      throw attachStatus(Object.assign(new Error('响应解析失败'), { category: 'parse_error' }), res.statusCode)
    }
  })
}

// 带超时的 Promise 包装（用于库调用）
// 支持可选的 abort 函数：超时后调用以取消底层请求，避免 socket 泄漏与堆积限流
function withTimeout (promise, ms, abortFn) {
  return new Promise((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (typeof abortFn === 'function') {
        try { abortFn() } catch (e) { /* 忽略 abort 异常 */ }
      }
      reject(new Error('请求超时'))
    }, ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    ).finally(() => {
      // promise 已 settle 后无需再 abort，但若已超时 abort 已执行过，重复调用无副作用
    })
    // 防止未消费的 timer 在 promise reject 后仍持有引用
  })
}

// ===== 通用 POST JSON 请求（带超时，支持 http/https，用于 DeepL 官方 API、DeepLX、第三方 AI） =====
function postJson (url, body, extraHeaders, timeoutMs = TIMEOUT_MS, signal) {
  return new Promise((resolve, reject) => {
    const ms = resolvePositiveTimeout(timeoutMs, TIMEOUT_MS)
    if ((signal && signal.aborted) || ms <= 0) {
      reject(new Error('请求超时'))
      return
    }
    let settled = false
    let req = null
    const postData = JSON.stringify(body)
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const transport = isHttps ? https : http
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json'
    }, extraHeaders || {})

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers,
      timeout: ms
    }

    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const fail = (err, statusCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      if (req) {
        try { req.destroy() } catch (e) { /* ignore */ }
      }
      attachStatus(err, statusCode)
      reject(err)
    }

    const onAbort = () => fail(new Error('请求超时'))

    const timer = setTimeout(() => {
      fail(new Error('请求超时'))
    }, ms)

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort)
    }

    req = transport.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('error', (err) => {
        fail(err, res.statusCode)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        if (res.statusCode && res.statusCode >= 400) {
          reject(httpStatusError(res.statusCode))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(attachStatus(new Error('响应解析失败'), res.statusCode))
        }
      })
    })

    req.on('error', (err) => {
      fail(err)
    })

    req.on('timeout', () => {
      fail(new Error('请求超时'))
    })

    req.write(postData)
    req.end()
  })
}

// ===== 通用 GET JSON 请求（带超时，支持 http/https，用于第三方 AI 模型列表接口） =====
function httpGetJson (url, extraHeaders, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ms = resolvePositiveTimeout(timeoutMs, TIMEOUT_MS)
    if (ms <= 0) {
      reject(new Error('请求超时'))
      return
    }
    let settled = false
    let req = null
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const transport = isHttps ? https : http
    const headers = Object.assign({
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json'
    }, extraHeaders || {})

    const fail = (err, statusCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (req) {
        try { req.destroy() } catch (e) { /* ignore */ }
      }
      attachStatus(err, statusCode)
      reject(err)
    }

    const timer = setTimeout(() => {
      fail(new Error('请求超时'))
    }, ms)

    req = transport.get(url, { headers, timeout: ms }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('error', (err) => {
        fail(err, res.statusCode)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (res.statusCode && res.statusCode >= 400) {
          reject(httpStatusError(res.statusCode))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(attachStatus(new Error('响应解析失败'), res.statusCode))
        }
      })
    })

    req.on('error', (err) => {
      fail(err)
    })

    req.on('timeout', () => {
      fail(new Error('请求超时'))
    })
  })
}

// ===== 翻译源 1：google-translate-api-x 库（内部 batch + single 双端点回退） =====
async function sourceLibrary (text, from, to, timeoutMs = TIMEOUT_MS, signal, transport) {
  const translate = getGoogleLibrary()
  if (!translate) {
    const err = new Error('库不可用')
    err.category = 'library_missing'
    throw err
  }
  const ms = resolvePositiveTimeout(timeoutMs, TIMEOUT_MS)
  if ((signal && signal.aborted) || ms <= 0) {
    throw timeoutError()
  }
  // 用 AbortController + 自定义 requestFunction，超时后取消底层请求；代理经 CONNECT 注入。
  const controller = createAbortController()
  const abort = () => {
    try { controller.abort() } catch (e) { /* ignore */ }
  }
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', abort)
  }
  try {
    const translatePromise = translate(text, {
      from,
      to,
      forceBatch: true,
      fallbackBatch: true,
      requestFunction: createLibraryRequestFunction({
        proxyUrl: transport && transport.proxyUrl,
        timeoutMs: ms,
        signal: controller.signal,
      }),
      requestOptions: { signal: controller.signal }
    })
    const result = await withTimeout(translatePromise, ms, abort)
    if (!result || !result.text) {
      const err = new Error('库返回空结果')
      err.category = 'empty_result'
      throw err
    }
    return result.text
  } finally {
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', abort)
    }
  }
}

// ===== 翻译源 2：translate.googleapis.com gtx 端点（dj=1，JSON 对象格式） =====
async function sourceGtxEndpoint (text, from, to, timeoutMs = TIMEOUT_MS, signal, transport) {
  const params = new URLSearchParams({
    client: 'gtx',
    dj: '1',
    dt: 't',
    sl: from,
    tl: to,
    q: text
  })
  const url = `https://translate.googleapis.com/translate_a/single?${params}`
  const data = await httpsGetJson(
    url,
    { Referer: 'https://translate.google.com' },
    timeoutMs,
    signal,
    transport && transport.proxyUrl
  )
  // 响应格式: { sentences: [{ trans, orig }], src }
  if (!data || !data.sentences || !Array.isArray(data.sentences)) {
    const err = new Error('gtx 端点返回格式异常')
    err.category = 'parse_error'
    throw err
  }
  const translation = data.sentences
    .filter(s => s && typeof s.trans === 'string')
    .map(s => s.trans)
    .join('')
  if (!translation) {
    const err = new Error('gtx 端点返回空结果')
    err.category = 'empty_result'
    throw err
  }
  return translation
}

// ===== 翻译源 3：clients5.google.com Chrome 扩展端点 =====
async function sourceClients5 (text, from, to, timeoutMs = TIMEOUT_MS, signal, transport) {
  const params = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: from,
    tl: to,
    q: text
  })
  const url = `https://clients5.google.com/translate_a/t?${params}`
  const data = await httpsGetJson(url, null, timeoutMs, signal, transport && transport.proxyUrl)
  // 响应格式: [["译文","检测语言"]]
  if (!Array.isArray(data) || !data[0] || !data[0][0]) {
    const err = new Error('clients5 端点返回格式异常')
    err.category = 'parse_error'
    throw err
  }
  const translation = data[0][0]
  if (typeof translation !== 'string' || !translation) {
    const err = new Error('clients5 端点返回空结果')
    err.category = 'empty_result'
    throw err
  }
  return translation
}

// ===== 多源轮换（依次尝试，成功即返回） =====
const DEFAULT_TRANSLATE_SOURCES = [
  { name: 'library', fn: sourceLibrary },
  { name: 'gtx', fn: sourceGtxEndpoint },
  { name: 'clients5', fn: sourceClients5 }
]
const TRANSLATE_SOURCES = DEFAULT_TRANSLATE_SOURCES.slice()

function setTranslateSourcesForTest (sources) {
  TRANSLATE_SOURCES.length = 0
  const list = Array.isArray(sources) ? sources : []
  for (const source of list) TRANSLATE_SOURCES.push(source)
}

function restoreTranslateSources () {
  setTranslateSourcesForTest(DEFAULT_TRANSLATE_SOURCES.slice())
}

function clearTranslateCache () {
  translateCache.clear()
  inflightRequests.clear()
}

function raceWithTimeout (promise, ms, abortFn) {
  let timer = null
  const wrapped = Promise.resolve(promise)
  wrapped.catch(() => {})
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (typeof abortFn === 'function') {
        try { abortFn() } catch (e) { /* ignore */ }
      }
      reject(timeoutError())
    }, ms)
  })
  return Promise.race([wrapped, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function toSafeAttempts (attempts) {
  return (attempts || []).map((item) => ({
    source: item.source,
    route: item.route,
    category: item.category,
    statusCode: item.statusCode == null ? null : item.statusCode,
    durationMs: item.durationMs,
  }))
}

function makeGoogleAggregateError (attempts, timedOut) {
  const last = attempts && attempts.length ? attempts[attempts.length - 1] : null
  let message = '所有谷歌翻译源均失败'
  if (timedOut || (last && last.category === 'timeout')) {
    message = '请求超时'
  } else if (last && last.category === 'proxy_connect') {
    message = '代理连接失败'
  } else if (last && last.category === 'http_error' && last.statusCode) {
    message = 'HTTP ' + last.statusCode
  } else if (last && last.category === 'parse_error') {
    message = '响应解析失败'
  } else if (last && last.category === 'empty_result') {
    message = '引擎返回空结果'
  } else if (last && last.category === 'network_error') {
    message = '网络请求失败'
  }
  const err = new Error(message)
  attachStatus(err, last && last.statusCode)
  err.googleAttempts = toSafeAttempts(attempts)
  if (last) {
    err.source = last.source
    err.route = last.route
    err.durationMs = last.durationMs
    if (last.category === 'proxy_connect' || last.category === 'network_error' || last.category === 'timeout') {
      err.category = last.category
    }
  }
  return err
}

async function runSourcePhase (text, from, to, phase) {
  const sources = TRANSLATE_SOURCES
  for (let i = 0; i < sources.length; i++) {
    if (phase.shouldStop() || (phase.signal && phase.signal.aborted)) {
      return { timedOut: true, result: null }
    }
    const remaining = phase.getRemaining()
    if (remaining <= 0) {
      return { timedOut: true, result: null }
    }
    const slice = sliceSourceBudget(remaining, sources.length - i)
    if (slice <= 0) {
      return { timedOut: true, result: null }
    }
    const source = sources[i]
    const sliceController = createAbortController()
    const abortSlice = () => {
      try { sliceController.abort() } catch (e) { /* ignore */ }
    }
    const onParentAbort = () => abortSlice()
    if (phase.signal && typeof phase.signal.addEventListener === 'function') {
      phase.signal.addEventListener('abort', onParentAbort)
    }
    const startedAt = Date.now()
    try {
      const result = await raceWithTimeout(
        source.fn(text, from, to, slice, sliceController.signal, {
          route: phase.route,
          proxyUrl: phase.proxyUrl,
        }),
        slice,
        abortSlice
      )
      const durationMs = coarseDuration(Date.now() - startedAt)
      if (result) {
        phase.attempts.push({
          source: source.name,
          route: phase.route,
          category: 'success',
          statusCode: null,
          durationMs,
        })
        return { timedOut: false, result }
      }
      phase.attempts.push({
        source: source.name,
        route: phase.route,
        category: 'empty_result',
        statusCode: null,
        durationMs,
      })
    } catch (err) {
      const classified = classifyGoogleSourceError(err)
      phase.attempts.push({
        source: source.name,
        route: phase.route,
        category: classified.category,
        statusCode: classified.statusCode,
        durationMs: coarseDuration(Date.now() - startedAt),
      })
      if (phase.shouldStop() || (phase.signal && phase.signal.aborted)) {
        return { timedOut: true, result: null }
      }
      // 429 不立即对同源连环重试：本阶段每个来源只走一次。
    } finally {
      abortSlice()
      if (phase.signal && typeof phase.signal.removeEventListener === 'function') {
        phase.signal.removeEventListener('abort', onParentAbort)
      }
    }
  }
  return { timedOut: phase.getRemaining() <= 0, result: null }
}

async function translateWithSources (text, from, to, opts) {
  const options = opts && typeof opts === 'object' ? opts : {}
  const shareBudget = options.shareBudget !== false
  const getRemaining = typeof options.getRemaining === 'function'
    ? options.getRemaining
    : () => TIMEOUT_MS
  const signal = options.signal
  const shouldStop = typeof options.shouldStop === 'function'
    ? options.shouldStop
    : () => false
  const overallRemaining = () => {
    if (shouldStop() || (signal && signal.aborted)) return 0
    const left = shareBudget ? getRemaining() : TIMEOUT_MS
    return left > 0 ? left : 0
  }
  const proxyUrl = resolveProxyUrl(options)
  const attempts = []

  const runPhase = (route, url, phaseGetRemaining) => runSourcePhase(text, from, to, {
    route,
    proxyUrl: url,
    getRemaining: phaseGetRemaining,
    signal,
    shouldStop,
    attempts,
  })

  if (proxyUrl) {
    const total = overallRemaining()
    const { proxyCap } = proxyPhaseBudget(total)
    const proxyDeadline = Date.now() + Math.min(proxyCap, total)
    const proxyRemaining = () => Math.max(0, Math.min(overallRemaining(), proxyDeadline - Date.now()))
    const proxyOutcome = await runPhase('proxy', proxyUrl, proxyRemaining)
    if (proxyOutcome.result) return proxyOutcome.result
    if (shouldStop() || (signal && signal.aborted)) {
      throw makeGoogleAggregateError(attempts, true)
    }
  }

  if (overallRemaining() <= 0) {
    throw makeGoogleAggregateError(attempts, true)
  }
  const directOutcome = await runPhase('direct', '', overallRemaining)
  if (directOutcome.result) return directOutcome.result
  throw makeGoogleAggregateError(
    attempts,
    directOutcome.timedOut || overallRemaining() <= 0
  )
}

// ===== DeepL 官方 API 翻译 =====
// 语言代码映射：项目内部 'en'/'zh-CN' → DeepL 'EN'/'ZH'
function mapLangForDeepL (lang) {
  const map = {
    'en': 'EN',
    'zh-CN': 'ZH',
    'zh': 'ZH',
    'zh-Hans': 'ZH',
    'zh-Hant': 'ZH-HANT'
  }
  return map[lang] || lang.toUpperCase()
}

async function translateWithDeepL (text, from, to, apiKey, timeoutMs) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('未配置 DeepL API Key，请在设置中填写')
  }

  // Free 版 key 以 :fx 结尾，使用 api-free.deepl.com；Pro 版使用 api.deepl.com
  const isFreeKey = apiKey.trim().endsWith(':fx')
  const baseUrl = isFreeKey
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate'

  const body = {
    text: [text],
    target_lang: mapLangForDeepL(to),
  }
  // source_lang 留空则自动检测
  if (from && from !== 'auto') {
    body.source_lang = mapLangForDeepL(from)
  }

  const data = await postJson(baseUrl, body, {
    'Authorization': `DeepL-Auth-Key ${apiKey.trim()}`
  }, resolvePositiveTimeout(timeoutMs, TIMEOUT_MS))

  if (!data || !data.translations || !Array.isArray(data.translations) || data.translations.length === 0) {
    throw new Error('DeepL 返回空结果')
  }
  const translation = data.translations[0].text
  if (!translation) {
    throw new Error('DeepL 返回空译文')
  }
  return translation
}

// ===== DeepLX 翻译（自部署/公共实例，REST API） =====
// 支持三种填法：
//   1. 完整 URL（含 token 和 /translate）：https://api.deeplxxx.org/TOKEN/translate
//   2. base URL + token：base=https://api.deeplxxx.org, token=TOKEN → 自动拼接为 base/token/translate
//   3. 纯 base URL（自部署无 token）：http://localhost:1188 → 自动补 /translate
async function translateWithDeepLX (text, from, to, serverUrl, token, timeoutMs) {
  if (!serverUrl || !serverUrl.trim()) {
    throw new Error('未配置 DeepLX 服务器地址，请在设置中填写')
  }

  const base = serverUrl.trim().replace(/\/+$/, '') // 去掉末尾斜杠
  const cleanToken = token && token.trim()

  // 拼接端点
  let endpoint
  if (base.endsWith('/translate')) {
    // 填法 1：完整 URL，直接用（可能已含 token 路径）
    endpoint = base
  } else if (cleanToken) {
    // 填法 2：base + token → base/token/translate
    endpoint = `${base}/${cleanToken}/translate`
  } else {
    // 填法 3：纯 base（自部署无 token）→ base/translate
    endpoint = `${base}/translate`
  }

  const body = {
    text,
    target_lang: mapLangForDeepL(to),
  }
  // source_lang 留空或 auto 则自动检测
  if (from && from !== 'auto') {
    body.source_lang = mapLangForDeepL(from)
  }

  // token 走 URL 路径，无需 Authorization header
  const data = await postJson(endpoint, body, null, resolvePositiveTimeout(timeoutMs, TIMEOUT_MS))

  // DeepLX 响应格式: { code, data, ... }。失败不回传服务端 message，避免把原文/令牌写入日志。
  if (!data || data.code !== 200 || !data.data) {
    const e = new Error('DeepLX 返回空结果')
    attachStatus(e, data && data.code)
    throw e
  }
  return data.data
}

// ===== 第三方 AI URL 推导 =====
// 用户只需填到 /v1（如 https://api.openai.com/v1），程序自动补全端点路径。
// 向下兼容：若用户已填 /chat/completions 或 /models，先剥离再重新拼接。
function deriveThirdpartyBasePath (url) {
  if (!url || !url.trim()) return ''
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length)
  }
  if (trimmed.endsWith('/models')) {
    return trimmed.slice(0, -'/models'.length)
  }
  return trimmed
}

function resolveChatCompletionsUrl (url) {
  return deriveThirdpartyBasePath(url) + '/chat/completions'
}

function resolveModelsUrl (url) {
  return deriveThirdpartyBasePath(url) + '/models'
}

// ===== 获取第三方 AI 模型列表（OpenAI 兼容 GET /v1/models 接口） =====
async function fetchThirdpartyModels (chatUrl, apiKey) {
  if (!chatUrl || !chatUrl.trim()) {
    throw new Error('未配置 API 链接')
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('未配置 API Key')
  }

  const trimmedUrl = chatUrl.trim()
  try {
    // 校验是合法 URL，避免 deriveThirdpartyBasePath 后拼接出无效字符串
    // eslint-disable-next-line no-new
    new URL(trimmedUrl)
  } catch {
    throw new Error('API 链接格式无效')
  }

  const modelsUrl = resolveModelsUrl(trimmedUrl)
  const data = await httpGetJson(modelsUrl, {
    Authorization: `Bearer ${apiKey.trim()}`
  })

  // OpenAI 标准响应：{ object: 'list', data: [{ id, object, created, owned_by }, ...] }
  if (!data || !Array.isArray(data.data)) {
    throw new Error('模型列表响应格式异常（期望 { data: [...] }）')
  }

  const models = data.data
    .filter(m => m && typeof m.id === 'string' && m.id)
    .map(m => m.id)

  if (models.length === 0) {
    throw new Error('未获取到模型（列表为空）')
  }
  // 去重 + 字母序排序，便于查找
  return Array.from(new Set(models)).sort()
}

// 通过 window 对象向渲染进程注入 nodejs 能力
function abortSharedGoogle(shared, cacheKey) {
  shared.cacheAllowed = false
  shared.aborted = true
  try { shared.controller.abort() } catch (e) { /* ignore */ }
  if (inflightRequests.get(cacheKey) === shared) {
    inflightRequests.delete(cacheKey)
  }
}

function getOrCreateGoogleInflight(cacheKey, text, from, to, hasBudget, waiterDeadline, proxyOpts) {
  let shared = inflightRequests.get(cacheKey)
  if (shared) {
    if (hasBudget && waiterDeadline > shared.deadline) {
      shared.deadline = waiterDeadline
      shared.shareBudget = true
    }
    return shared
  }

  shared = {
    waiters: 0,
    deadline: hasBudget ? waiterDeadline : Date.now() + TIMEOUT_MS,
    shareBudget: true,
    cacheAllowed: true,
    aborted: false,
    controller: createAbortController(),
    proxyEnabled: !!(proxyOpts && proxyOpts.proxyEnabled),
    proxyUrl: resolveProxyUrl(proxyOpts),
  }
  const getRemaining = () => {
    const left = shared.deadline - Date.now()
    return left > 0 ? left : 0
  }
  // 等同一 tick 的等待者先加入并扩展共享预算，避免首位短预算在后续等待者登记前
  // 固定了单源切片（后续长预算等待者会被错误地一起超时）。
  shared.promise = Promise.resolve().then(() => translateWithSources(text, from, to, {
    getRemaining,
    shareBudget: true,
    signal: shared.controller.signal,
    shouldStop: () => shared.aborted,
    proxyEnabled: shared.proxyEnabled,
    proxyUrl: shared.proxyUrl,
  })).then((result) => {
    if (shared.cacheAllowed && !shared.aborted && result) {
      setCache(cacheKey, result)
    }
    return result
  }).finally(() => {
    if (inflightRequests.get(cacheKey) === shared) {
      inflightRequests.delete(cacheKey)
    }
  })
  shared.promise.catch(() => {})
  inflightRequests.set(cacheKey, shared)
  return shared
}

window.services = {
  googleTranslate (text, from, to, timeoutMs, options) {
    let opts = options
    let budgetArg = timeoutMs
    if (timeoutMs && typeof timeoutMs === 'object') {
      opts = timeoutMs
      budgetArg = timeoutMs.timeoutMs
    }
    const proxyOpts = {
      proxyEnabled: !!(opts && opts.proxyEnabled),
      proxyUrl: opts && opts.proxyUrl,
    }
    const cacheKey = `${from}|${to}|${text}|${googleRouteKey(proxyOpts)}`
    const cached = getCache(cacheKey)
    if (cached !== null) {
      return Promise.resolve(cached)
    }
    const hasBudget = Number.isFinite(Number(budgetArg)) && Number(budgetArg) > 0
    const budget = hasBudget ? Number(budgetArg) : TIMEOUT_MS
    const waiterDeadline = Date.now() + budget
    const shared = getOrCreateGoogleInflight(cacheKey, text, from, to, hasBudget, waiterDeadline, proxyOpts)
    shared.waiters += 1

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (err, value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        shared.waiters -= 1
        if (err) {
          if (shared.waiters <= 0) abortSharedGoogle(shared, cacheKey)
          reject(err)
          return
        }
        resolve(value)
      }
      const timer = hasBudget
        ? setTimeout(() => finish(new Error('请求超时')), budget)
        : null
      shared.promise.then(
        (value) => finish(null, value),
        (err) => finish(err || new Error('所有谷歌翻译源均失败'))
      )
    })
  },
  deeplTranslate (text, from, to, apiKey, timeoutMs) {
    return translateWithDeepL(text, from, to, apiKey, timeoutMs)
  },
  deeplxTranslate (text, from, to, serverUrl, token, timeoutMs) {
    return translateWithDeepLX(text, from, to, serverUrl, token, timeoutMs)
  },
  baiduTranslate (text, from, to, appid, secret, timeoutMs) {
    return translateWithBaidu(text, from, to, appid, secret, timeoutMs)
  },
  aliyunTranslate (text, from, to, accessKeyId, accessKeySecret, timeoutMs) {
    return translateWithAliyun(text, from, to, accessKeyId, accessKeySecret, timeoutMs)
  },
  caiyunTranslate (text, from, to, token, timeoutMs) {
    return translateWithCaiyun(text, from, to, token, timeoutMs)
  },
  requestThirdpartyAI (url, apiKey, body, timeoutMs) {
    // 用户只需填到 /v1，这里自动补全 /chat/completions（向下兼容已填完整路径）
    const endpoint = resolveChatCompletionsUrl(url)
    return postJson(endpoint, body, {
      'Authorization': `Bearer ${apiKey}`
    }, resolvePositiveTimeout(timeoutMs, THIRDPARTY_AI_TIMEOUT_MS))
  },
  fetchThirdpartyModels (chatUrl, apiKey) {
    return fetchThirdpartyModels(chatUrl, apiKey)
  },
  lookupWord (word) {
    return new Promise((resolve) => {
      if (!word || typeof word !== 'string' || !word.trim()) {
        resolve(EMPTY_DICT_RESULT)
        return
      }

      const encodedWord = encodeURIComponent(word.trim())
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodedWord}`

      const req = https.get(url, { timeout: LOOKUP_TIMEOUT_MS }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('error', () => {})
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (!Array.isArray(parsed) || parsed.length === 0) {
              resolve(EMPTY_DICT_RESULT)
              return
            }

            const entry = parsed[0]
            const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics[0]?.text) || ''

            const definitions = []
            const examples = []

            for (const meaning of entry.meanings || []) {
              for (const def of meaning.definitions || []) {
                if (definitions.length < 3) {
                  definitions.push({
                    pos: meaning.partOfSpeech || '',
                    meaning: def.definition || '',
                    example: def.example || '',
                  })
                }
                if (examples.length < 2 && def.example) {
                  examples.push(def.example)
                }
              }
            }

            resolve({ phonetic, definitions, examples })
          } catch {
            resolve(EMPTY_DICT_RESULT)
          }
        })
      })

      req.on('error', () => {
        resolve(EMPTY_DICT_RESULT)
      })

      req.on('timeout', () => {
        req.destroy()
        resolve(EMPTY_DICT_RESULT)
      })
    })
  },
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.__test__ = {
    TIMEOUT_MS,
    THIRDPARTY_AI_TIMEOUT_MS,
    LOOKUP_TIMEOUT_MS,
    translateWithSources,
    setTranslateSourcesForTest,
    restoreTranslateSources,
    clearTranslateCache,
    getCache,
    setCache,
    inflightRequests,
    httpsGetJson,
    postJson,
    httpGetJson,
    withTimeout,
    parseGoogleProxyUrl,
    resolveProxyUrl,
    googleRouteKey,
    sliceSourceBudget,
    proxyPhaseBudget,
    coarseDuration,
    classifyGoogleSourceError,
    googleHttpRequest,
    setAllowedGoogleHostsForTest,
    restoreAllowedGoogleHosts,
  }
}
