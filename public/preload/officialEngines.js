'use strict'

const crypto = require('node:crypto')
const https = require('https')

const BAIDU_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
const ALIYUN_HOST = 'mt.aliyuncs.com'
const ALIYUN_URL = 'https://mt.aliyuncs.com/'
const CAIYUN_URL = 'https://api.interpreter.caiyunai.com/v1/translator'
const TIMEOUT_MS = 5000

function resolvePositiveTimeout(timeoutMs, fallback) {
  const n = Number(timeoutMs)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function attachStatus(err, statusCode) {
  if (!err || typeof err !== 'object') return err
  const code = Number(statusCode)
  if (Number.isFinite(code) && code >= 100 && code <= 599 && err.statusCode == null) {
    err.statusCode = code
  }
  return err
}

function httpStatusError(statusCode) {
  const e = new Error('HTTP ' + statusCode)
  attachStatus(e, statusCode)
  e.category = 'http_error'
  return e
}

function timeoutError() {
  const e = new Error('请求超时')
  e.category = 'timeout'
  return e
}

function networkError() {
  const e = new Error('网络请求失败')
  e.category = 'network_error'
  return e
}

function parseError() {
  const e = new Error('响应解析失败')
  e.category = 'parse_error'
  return e
}

function emptyResultError() {
  const e = new Error('引擎返回空结果')
  e.category = 'empty_result'
  return e
}

const BUSINESS_MESSAGES = {
  auth_error: '引擎鉴权失败',
  quota_error: '引擎额度不足或服务未开通',
  rate_limit: '引擎请求受限流',
  business_error: '引擎返回业务错误',
}

function businessError(category = 'business_error') {
  const safeCategory = BUSINESS_MESSAGES[category] ? category : 'business_error'
  const e = new Error(BUSINESS_MESSAGES[safeCategory])
  e.category = safeCategory
  return e
}

function isBlank(value) {
  return !value || !String(value).trim()
}

function assertInputLimit(text, limit) {
  if (Array.from(String(text == null ? '' : text)).length > limit) {
    const e = new Error('文本超过该引擎单次限制')
    e.category = 'input_limit'
    throw e
  }
}

function assertHttpsOfficialUrl(url, allowedHost) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw networkError()
  }
  if (parsed.protocol !== 'https:') throw networkError()
  if (parsed.hostname !== allowedHost) throw networkError()
  return parsed
}

function defaultRequestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ms = resolvePositiveTimeout(options.timeoutMs, TIMEOUT_MS)
    if (ms <= 0) {
      reject(timeoutError())
      return
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      reject(networkError())
      return
    }
    if (parsed.protocol !== 'https:' || ![
      'fanyi-api.baidu.com',
      ALIYUN_HOST,
      'api.interpreter.caiyunai.com',
    ].includes(parsed.hostname)) {
      reject(networkError())
      return
    }
    const method = (options.method || 'POST').toUpperCase()
    const body = options.body == null ? '' : String(options.body)
    const headers = Object.assign({
      Accept: 'application/json',
    }, options.headers || {})
    if (body && headers['Content-Length'] == null && headers['content-length'] == null) {
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    let settled = false
    let req = null
    const fail = (err, statusCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (req) {
        try { req.destroy() } catch (e) { /* ignore */ }
      }
      if (err && err.category) {
        if (statusCode >= 400) attachStatus(err, statusCode)
        reject(err)
        return
      }
      reject(statusCode >= 400 ? attachStatus(networkError(), statusCode) : networkError())
    }

    const timer = setTimeout(() => fail(timeoutError()), ms)

    try {
      req = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: ms,
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('error', () => fail(networkError(), res.statusCode))
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
          } catch {
            reject(parseError())
          }
        })
      })

      req.on('error', () => fail(networkError()))
      req.on('timeout', () => fail(timeoutError()))
      if (body) req.write(body)
      req.end()
    } catch {
      fail(networkError())
    }
  })
}

let requestJsonImpl = defaultRequestJson

function requestJson(url, options) {
  return requestJsonImpl(url, options)
}

function mapToZhEn(lang) {
  const raw = lang == null ? '' : String(lang).trim()
  const lower = raw.toLowerCase()
  if (lower === 'en' || lower === 'en-us' || lower === 'en-gb') return 'en'
  if (
    lower === 'zh'
    || lower === 'zh-cn'
    || lower === 'zh-hans'
    || lower === 'zh-sg'
    || raw === 'zh-CN'
  ) return 'zh'
  return lower || 'zh'
}

function caiyunTransType(from, to) {
  const source = mapToZhEn(from)
  const target = mapToZhEn(to)
  if (source === 'en' && target === 'zh') return 'en2zh'
  if (source === 'zh' && target === 'en') return 'zh2en'
  throw businessError()
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmacSha256Hex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex')
}

function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => (
    '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  ))
}

function formEncode(params) {
  return Object.keys(params).map((key) => (
    percentEncode(key) + '=' + percentEncode(params[key] == null ? '' : params[key])
  )).join('&')
}

function canonicalQuery(params) {
  return Object.keys(params || {}).sort().map((key) => (
    percentEncode(key) + '=' + percentEncode(params[key] == null ? '' : params[key])
  )).join('&')
}

function buildAcs3Auth({
  method,
  canonicalUri,
  query,
  headers,
  body,
  accessKeyId,
  accessKeySecret,
}) {
  const hashedPayload = sha256Hex(body || '')
  const headerMap = {}
  Object.keys(headers || {}).forEach((key) => {
    headerMap[String(key).toLowerCase()] = String(headers[key]).trim()
  })
  headerMap['x-acs-content-sha256'] = hashedPayload
  const signedNames = Object.keys(headerMap)
    .filter((key) => key === 'host' || key === 'content-type' || key.startsWith('x-acs-'))
    .sort()
  const canonicalHeaders = signedNames.map((key) => key + ':' + headerMap[key] + '\n').join('')
  const signedHeaders = signedNames.join(';')
  const canonicalRequest = [
    String(method || 'POST').toUpperCase(),
    canonicalUri || '/',
    query && Object.keys(query).length ? canonicalQuery(query) : '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')
  const stringToSign = 'ACS3-HMAC-SHA256\n' + sha256Hex(canonicalRequest)
  const signature = hmacSha256Hex(accessKeySecret, stringToSign)
  return {
    authorization: 'ACS3-HMAC-SHA256 Credential=' + accessKeyId
      + ',SignedHeaders=' + signedHeaders
      + ',Signature=' + signature,
    hashedPayload,
    signedHeaders,
    canonicalRequest,
    stringToSign,
    signature,
    headers: headerMap,
  }
}

function baiduSign(appid, q, salt, secret) {
  return crypto.createHash('md5').update(String(appid) + String(q) + String(salt) + String(secret), 'utf8').digest('hex')
}

function parseBaiduResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw parseError()
  if (data.error_code != null && String(data.error_code) !== '52000') {
    const code = String(data.error_code)
    if (['52003', '54001'].includes(code)) throw businessError('auth_error')
    if (code === '54003') throw businessError('rate_limit')
    if (code === '54004') throw businessError('quota_error')
    throw businessError()
  }
  const rows = data.trans_result
  if (!Array.isArray(rows) || rows.length === 0) throw emptyResultError()
  const translation = rows.map((row) => (row && row.dst != null ? String(row.dst) : '')).join('\n').trim()
  if (!translation) throw emptyResultError()
  return translation
}

function parseAliyunResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw parseError()
  const code = data.Code
  if (!(code === 200 || code === '200')) {
    const normalized = String(code)
    if (normalized === '10009') throw businessError('auth_error')
    if (['10010', '10013'].includes(normalized)) throw businessError('quota_error')
    throw businessError()
  }
  const translated = data.Data && data.Data.Translated
  if (translated == null || !String(translated).trim()) throw emptyResultError()
  return String(translated)
}

function parseCaiyunResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw parseError()
  if (data.error || data.error_code || (data.code != null && ![0, 200, '0', '200'].includes(data.code))
    || (data.message && data.message !== 'success')) throw businessError()
  const target = data.target
  if (typeof target === 'string' && target.trim()) return target
  if (Array.isArray(target) && target.length) {
    const joined = target.map((item) => (item == null ? '' : String(item))).join('\n').trim()
    if (joined) return joined
  }
  throw emptyResultError()
}

async function translateWithBaidu(text, from, to, appid, secret, timeoutMs) {
  if (isBlank(appid) || isBlank(secret)) throw businessError()
  assertInputLimit(text, 1000)
  assertHttpsOfficialUrl(BAIDU_URL, 'fanyi-api.baidu.com')
  const q = text == null ? '' : String(text)
  const salt = String(Date.now()) + Math.floor(Math.random() * 1e6)
  const sign = baiduSign(String(appid).trim(), q, salt, String(secret).trim())
  const body = formEncode({
    q,
    from: mapToZhEn(from),
    to: mapToZhEn(to),
    appid: String(appid).trim(),
    salt,
    sign,
  })
  const data = await requestJson(BAIDU_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs: resolvePositiveTimeout(timeoutMs, TIMEOUT_MS),
  })
  return parseBaiduResponse(data)
}

async function translateWithAliyun(text, from, to, accessKeyId, accessKeySecret, timeoutMs) {
  if (isBlank(accessKeyId) || isBlank(accessKeySecret)) throw businessError()
  assertInputLimit(text, 5000)
  assertHttpsOfficialUrl(ALIYUN_URL, ALIYUN_HOST)
  const body = formEncode({
    FormatType: 'text',
    SourceLanguage: mapToZhEn(from),
    TargetLanguage: mapToZhEn(to),
    SourceText: text == null ? '' : String(text),
    Scene: 'general',
  })
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const nonce = crypto.randomBytes(16).toString('hex')
  const signed = buildAcs3Auth({
    method: 'POST',
    canonicalUri: '/',
    query: {},
    headers: {
      host: ALIYUN_HOST,
      'content-type': 'application/x-www-form-urlencoded',
      'x-acs-action': 'TranslateGeneral',
      'x-acs-version': '2018-10-12',
      'x-acs-date': date,
      'x-acs-signature-nonce': nonce,
    },
    body,
    accessKeyId: String(accessKeyId).trim(),
    accessKeySecret: String(accessKeySecret).trim(),
  })
  const data = await requestJson(ALIYUN_URL, {
    method: 'POST',
    headers: {
      Host: ALIYUN_HOST,
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-acs-action': 'TranslateGeneral',
      'x-acs-version': '2018-10-12',
      'x-acs-date': date,
      'x-acs-signature-nonce': nonce,
      'x-acs-content-sha256': signed.hashedPayload,
      Authorization: signed.authorization,
    },
    body,
    timeoutMs: resolvePositiveTimeout(timeoutMs, TIMEOUT_MS),
  })
  return parseAliyunResponse(data)
}

async function translateWithCaiyun(text, from, to, token, timeoutMs) {
  if (isBlank(token)) throw businessError()
  assertHttpsOfficialUrl(CAIYUN_URL, 'api.interpreter.caiyunai.com')
  const body = JSON.stringify({
    source: text == null ? '' : String(text),
    trans_type: caiyunTransType(from, to),
    detect: false,
    media: 'text',
  })
  const data = await requestJson(CAIYUN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Authorization': 'token ' + String(token).trim(),
    },
    body,
    timeoutMs: resolvePositiveTimeout(timeoutMs, TIMEOUT_MS),
  })
  return parseCaiyunResponse(data)
}

function setRequestJsonForTest(fn) {
  requestJsonImpl = typeof fn === 'function' ? fn : defaultRequestJson
}

function restoreRequestJson() {
  requestJsonImpl = defaultRequestJson
}

module.exports = {
  translateWithBaidu,
  translateWithAliyun,
  translateWithCaiyun,
  __test__: {
    TIMEOUT_MS,
    BAIDU_URL,
    ALIYUN_URL,
    CAIYUN_URL,
    mapToZhEn,
    caiyunTransType,
    percentEncode,
    formEncode,
    canonicalQuery,
    buildAcs3Auth,
    baiduSign,
    parseBaiduResponse,
    parseAliyunResponse,
    parseCaiyunResponse,
    setRequestJsonForTest,
    restoreRequestJson,
  },
}
