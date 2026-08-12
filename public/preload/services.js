const fs = require('node:fs')
const path = require('node:path')
const https = require('https')
const http = require('http')
const translate = require('google-translate-api-x')

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
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ===== 请求诊断上下文（仅用于失败日志，敏感信息脱敏） =====
// 目的：翻译调用失败时，把"实际发出的请求"附在 Error 上，供上层 logger 打印诊断。
// 脱敏策略：Authorization 头与服务端 token 仅保留首 2 + 末 4 字符，中间以 ... 占位，
// 既能让用户核对配置是否填对，又不把完整凭据写入本地日志。

/** 脱敏单个敏感字符串：保留首 2 + 末 4，中间以 ... 占位 */
function maskMiddle (s) {
  if (s == null) return s
  s = String(s)
  if (s.length <= 8) return s
  return s.slice(0, 2) + '...' + s.slice(-4)
}

/** 脱敏带前缀的凭据（如 'Bearer sk-xxx'、'DeepL-Auth-Key xxx'） */
function maskSecret (s) {
  if (s == null) return s
  s = String(s)
  const PREFIXES = ['DeepL-Auth-Key ', 'Bearer ']
  for (const p of PREFIXES) {
    if (s.startsWith(p)) return p + maskMiddle(s.slice(p.length))
  }
  return maskMiddle(s)
}

/** 脱敏 URL 路径中的 token 段（形如 https://host/<token>/translate） */
function maskUrlToken (url) {
  if (!url) return url
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length >= 2 && segs[segs.length - 1] === 'translate') {
      segs[segs.length - 2] = maskMiddle(segs[segs.length - 2])
      return `${u.protocol}//${u.host}/${segs.join('/')}${u.search}`
    }
  } catch (e) { /* 非 URL 原样返回 */ }
  return url
}

/** 构建可安全记录的请求上下文（headers 脱敏，body 原样保留以便诊断） */
function buildRequestContext (method, url, headers, body) {
  const safeHeaders = {}
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      safeHeaders[k] = /^authorization$/i.test(k) ? maskSecret(v) : v
    }
  }
  const ctx = { method, url: maskUrlToken(url), headers: safeHeaders }
  if (body !== undefined) ctx.body = body
  return ctx
}

/** 把请求/响应诊断信息附到 Error 上（幂等：已存在则跳过） */
function attachDiagnostics (err, request, response) {
  if (!err || typeof err !== 'object') return err
  if (request && !err.request) err.request = request
  if (response && !err.response) err.response = response
  return err
}

// ===== 通用 HTTPS GET JSON 请求（带超时） =====
// 用于 Google 翻译 gtx / clients5 端点；失败时把请求上下文附到 Error 供日志诊断。
function httpsGetJson (url, extraHeaders, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const headers = Object.assign({
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json, text/plain, */*'
    }, extraHeaders || {})

    const reqContext = buildRequestContext('GET', url, headers)

    const fail = (err, response) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      attachDiagnostics(err, reqContext, response)
      reject(err)
    }

    const timer = setTimeout(() => {
      if (settled) return
      fail(new Error('请求超时'))
    }, timeoutMs)

    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('error', (err) => {
        fail(err, { status: res.statusCode, body: data.slice(0, 500) })
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // HTTP 错误状态码：构造含状态码与响应片段的错误，便于上层诊断真实原因（4xx/5xx）
        if (res.statusCode && res.statusCode >= 400) {
          const e = new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          const e = new Error('响应解析失败: ' + err.message + (data ? ' (body: ' + data.slice(0, 120) + ')' : ''))
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
        }
      })
    })

    req.on('error', (err) => {
      fail(err)
    })

    req.on('timeout', () => {
      if (settled) return
      req.destroy()
      fail(new Error('请求超时'))
    })
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
function postJson (url, body, extraHeaders, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
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

    // 请求诊断上下文（脱敏后），失败时附加到 Error 供上层日志打印
    const reqContext = buildRequestContext('POST', url, headers, body)

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers
    }

    const fail = (err, response) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      attachDiagnostics(err, reqContext, response)
      reject(err)
    }

    const timer = setTimeout(() => {
      if (settled) return
      fail(new Error('请求超时'))
    }, timeoutMs)

    const req = transport.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('error', (err) => {
        fail(err, { status: res.statusCode, body: data.slice(0, 500) })
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // HTTP 错误状态码：构造含状态码与响应片段的错误，便于上层诊断（如 DeepL 403 key 无效、429 限流、DeepLX 401 鉴权）
        if (res.statusCode && res.statusCode >= 400) {
          const e = new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          const e = new Error('响应解析失败: ' + err.message + (data ? ' (body: ' + data.slice(0, 120) + ')' : ''))
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
        }
      })
    })

    req.on('error', (err) => {
      fail(err)
    })

    req.on('timeout', () => {
      if (settled) return
      req.destroy()
      fail(new Error('请求超时'))
    })

    req.write(postData)
    req.end()
  })
}

// ===== 通用 GET JSON 请求（带超时，支持 http/https，用于第三方 AI 模型列表接口） =====
function httpGetJson (url, extraHeaders, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const transport = isHttps ? https : http
    const headers = Object.assign({
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json'
    }, extraHeaders || {})

    const reqContext = buildRequestContext('GET', url, headers)

    const fail = (err, response) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      attachDiagnostics(err, reqContext, response)
      reject(err)
    }

    const timer = setTimeout(() => {
      if (settled) return
      fail(new Error('请求超时'))
    }, timeoutMs)

    const req = transport.get(url, { headers, timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('error', (err) => {
        fail(err, { status: res.statusCode, body: data.slice(0, 500) })
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // HTTP 错误状态码：构造含状态码与响应片段的错误，便于上层诊断（如 401 key 无效）
        if (res.statusCode && res.statusCode >= 400) {
          const e = new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          const e = new Error('响应解析失败: ' + err.message + (data ? ' (body: ' + data.slice(0, 120) + ')' : ''))
          attachDiagnostics(e, reqContext, { status: res.statusCode, body: data.slice(0, 500) })
          reject(e)
        }
      })
    })

    req.on('error', (err) => {
      fail(err)
    })

    req.on('timeout', () => {
      if (settled) return
      req.destroy()
      fail(new Error('请求超时'))
    })
  })
}

// ===== 翻译源 1：google-translate-api-x 库（内部 batch + single 双端点回退） =====
async function sourceLibrary (text, from, to) {
  // 用 AbortController 接入库的 requestOptions.signal，超时后真正取消底层 fetch，
  // 避免 socket 在事件循环中堆积造成 fd 泄漏与持续触发 Google 端 429 限流
  const controller = new AbortController()
  const translatePromise = translate(text, {
    from,
    to,
    forceBatch: true,
    fallbackBatch: true,
    requestOptions: { signal: controller.signal }
  })
  const result = await withTimeout(translatePromise, TIMEOUT_MS, () => controller.abort())
  if (!result || !result.text) {
    throw new Error('库返回空结果')
  }
  return result.text
}

// ===== 翻译源 2：translate.googleapis.com gtx 端点（dj=1，JSON 对象格式） =====
async function sourceGtxEndpoint (text, from, to) {
  const params = new URLSearchParams({
    client: 'gtx',
    dj: '1',
    dt: 't',
    sl: from,
    tl: to,
    q: text
  })
  const url = `https://translate.googleapis.com/translate_a/single?${params}`
  const data = await httpsGetJson(url, { Referer: 'https://translate.google.com' })
  // 响应格式: { sentences: [{ trans, orig }], src }
  if (!data || !data.sentences || !Array.isArray(data.sentences)) {
    throw new Error('gtx 端点返回格式异常')
  }
  const translation = data.sentences
    .filter(s => s && typeof s.trans === 'string')
    .map(s => s.trans)
    .join('')
  if (!translation) {
    throw new Error('gtx 端点返回空结果')
  }
  return translation
}

// ===== 翻译源 3：clients5.google.com Chrome 扩展端点 =====
async function sourceClients5 (text, from, to) {
  const params = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: from,
    tl: to,
    q: text
  })
  const url = `https://clients5.google.com/translate_a/t?${params}`
  const data = await httpsGetJson(url)
  // 响应格式: [["译文","检测语言"]]
  if (!Array.isArray(data) || !data[0] || !data[0][0]) {
    throw new Error('clients5 端点返回格式异常')
  }
  const translation = data[0][0]
  if (typeof translation !== 'string' || !translation) {
    throw new Error('clients5 端点返回空结果')
  }
  return translation
}

// ===== 多源轮换（依次尝试，成功即返回） =====
const TRANSLATE_SOURCES = [
  { name: 'library', fn: sourceLibrary },
  { name: 'gtx', fn: sourceGtxEndpoint },
  { name: 'clients5', fn: sourceClients5 }
]

async function translateWithSources (text, from, to) {
  const errors = []
  // 收集每个源的请求诊断上下文（若失败），附到聚合错误供上层日志打印
  const sourceContexts = []
  for (const source of TRANSLATE_SOURCES) {
    try {
      const result = await source.fn(text, from, to)
      if (result) return result
      errors.push(`${source.name}: 返回空`)
    } catch (err) {
      const entry = `${source.name}: ${err.message || String(err)}`
      errors.push(entry)
      sourceContexts.push({
        source: source.name,
        message: err.message || String(err),
        request: err.request || null,
        response: err.response || null,
      })
      // 继续尝试下一个源
    }
  }
  const aggErr = new Error('所有谷歌翻译源均失败 (' + errors.join('; ') + ')')
  // 聚合请求上下文：汇总三个源的实际请求，方便一次性诊断
  aggErr.request = { engine: 'google', from, to, text: text.slice(0, 100), sources: sourceContexts }
  throw aggErr
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

async function translateWithDeepL (text, from, to, apiKey) {
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
  })

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
async function translateWithDeepLX (text, from, to, serverUrl, token) {
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
  const data = await postJson(endpoint, body)

  // DeepLX 响应格式: { code, data, ... }
  if (!data || data.code !== 200 || !data.data) {
    const msg = (data && data.message) || `HTTP ${data && data.code}`
    throw new Error('DeepLX 翻译失败: ' + msg)
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
window.services = {
  googleTranslate (text, from, to) {
    const cacheKey = `${from}|${to}|${text}`
    const cached = getCache(cacheKey)
    if (cached !== null) {
      return Promise.resolve(cached)
    }
    // inflight 去重：若已有相同 key 的请求在飞，复用其 Promise，避免并发双 miss 击穿缓存
    const existing = inflightRequests.get(cacheKey)
    if (existing) {
      return existing
    }
    const p = translateWithSources(text, from, to).then(result => {
      setCache(cacheKey, result)
      return result
    }).finally(() => {
      inflightRequests.delete(cacheKey)
    })
    inflightRequests.set(cacheKey, p)
    return p
  },
  deeplTranslate (text, from, to, apiKey) {
    return translateWithDeepL(text, from, to, apiKey)
  },
  deeplxTranslate (text, from, to, serverUrl, token) {
    return translateWithDeepLX(text, from, to, serverUrl, token)
  },
  requestThirdpartyAI (url, apiKey, body) {
    // 用户只需填到 /v1，这里自动补全 /chat/completions（向下兼容已填完整路径）
    const endpoint = resolveChatCompletionsUrl(url)
    return postJson(endpoint, body, {
      'Authorization': `Bearer ${apiKey}`
    }, 30000)
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

      const req = https.get(url, { timeout: 5000 }, (res) => {
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
