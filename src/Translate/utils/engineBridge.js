/**
 * 翻译引擎桥接检查、故障分类与故障转移调度。
 * 纯逻辑：window / 服务通过参数注入，便于隔离测试。
 */

import { hasReadyThirdpartyAiGroup } from './thirdpartyAiGroups.js'
import { sanitizeGoogleAttempts } from './safeLog.js'

export const ENGINE_DISPLAY_NAMES = {
  ai: 'uTools AI',
  'thirdparty-ai': '自定义 AI',
  google: 'Google 翻译',
  deepl: 'DeepL 官方',
  deeplx: 'DeepLX 自部署',
  baidu: '百度翻译',
  aliyun: '阿里翻译',
  caiyun: '彩云小译',
}

export const PRELOAD_METHODS = {
  google: 'googleTranslate',
  deepl: 'deeplTranslate',
  deeplx: 'deeplxTranslate',
  'thirdparty-ai': 'requestThirdpartyAI',
  baidu: 'baiduTranslate',
  aliyun: 'aliyunTranslate',
  caiyun: 'caiyunTranslate',
}

export const SKIP_REASON = {
  BRIDGE_MISSING: 'bridge_missing',
  METHOD_MISSING: 'method_missing',
  NOT_CONFIGURED: 'not_configured',
  INPUT_LIMIT: 'input_limit',
}

export const SKIP_CATEGORY = {
  ENV: 'env',
  CONFIG: 'config',
  INPUT: 'input',
}

export const ERROR_CATEGORY = {
  STATUS_524: 'status_524',
  BRIDGE_MISSING: 'bridge_missing',
  METHOD_MISSING: 'method_missing',
  NOT_CONFIGURED: 'not_configured',
  INPUT_LIMIT: 'input_limit',
  AUTH_ERROR: 'auth_error',
  QUOTA_ERROR: 'quota_error',
  RATE_LIMIT: 'rate_limit',
  BUSINESS_ERROR: 'business_error',
  HTTP_ERROR: 'http_error',
  TIMEOUT: 'timeout',
  PARSE_ERROR: 'parse_error',
  EMPTY_RESULT: 'empty_result',
  NETWORK_ERROR: 'network_error',
  PROXY_CONNECT: 'proxy_connect',
  UNKNOWN: 'unknown',
}

/** 百度标准版 / 阿里 TranslateGeneral 官方单次字符上限；彩云不自设阈值 */
export const ENGINE_CHAR_LIMITS = {
  baidu: 1000,
  aliyun: 5000,
}

export const PHASE = {
  CALL: 'call',
  SKIP: 'skip',
  PARSE: 'parse',
  FALLBACK: 'fallback',
  TEST: 'test',
  LOOKUP: 'lookup',
}

export const EMPTY_DICT = { phonetic: '', definitions: [], examples: [] }

export const DICT_ENGINES = {
  google: true,
  deepl: true,
  deeplx: true,
  baidu: true,
  aliyun: true,
  caiyun: true,
}

const DEFAULT_ENGINE_TIMEOUT_MS = 5000

export const SAFE_MESSAGES = {
  STATUS_524: '上游返回 524（无响应体）',
  BRIDGE_MISSING: '翻译服务未加载',
  METHOD_MISSING: '翻译服务方法不可用',
  NOT_CONFIGURED: '引擎未配置必要凭据或地址',
  INPUT_LIMIT: '文本超过该引擎单次限制',
  AUTH_ERROR: '引擎鉴权失败',
  QUOTA_ERROR: '引擎额度不足或服务未开通',
  RATE_LIMIT: '引擎请求受限流',
  BUSINESS_ERROR: '引擎返回业务错误',
  HTTP_ERROR: '引擎返回 HTTP 错误',
  TIMEOUT: '引擎请求超时',
  PARSE_ERROR: '翻译结果解析失败',
  EMPTY_RESULT: '引擎返回空结果',
  NETWORK_ERROR: '网络请求失败',
  PROXY_CONNECT: '代理连接失败',
  UNKNOWN: '引擎调用失败',
  RELOAD_HINT: '翻译服务未加载。请重载插件，或确认安装的是最新版本后重新安装。',
}

export function getRuntimeEnv(globalRef) {
  const g = globalRef || (typeof globalThis !== 'undefined' ? globalThis : {})
  const w = (typeof window !== 'undefined' ? window : g) || g
  return {
    services: w.services,
    utools: w.utools,
  }
}

export function hasServiceMethod(method, env = getRuntimeEnv()) {
  const services = env && env.services
  return !!(services && typeof services[method] === 'function')
}

export function engineDisplayName(engine) {
  return ENGINE_DISPLAY_NAMES[engine] || engine
}

function isBlank(value) {
  return !value || !String(value).trim()
}

/**
 * 检查引擎当前是否可真实发起调用。
 * 环境缺失优先于配置缺失：桥接不存在时即使未配置也不发请求。
 */
export function inspectEngine(engine, settings = {}, env = getRuntimeEnv()) {
  if (engine === 'ai') {
    const utools = env && env.utools
    if (!utools || typeof utools.ai !== 'function') {
      return {
        status: 'skipped',
        skipReason: SKIP_REASON.METHOD_MISSING,
        skipCategory: SKIP_CATEGORY.ENV,
        category: ERROR_CATEGORY.METHOD_MISSING,
        safeMessage: SAFE_MESSAGES.METHOD_MISSING,
      }
    }
    return { status: 'ready' }
  }

  const method = PRELOAD_METHODS[engine]
  const services = env && env.services
  if (!services) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.BRIDGE_MISSING,
      skipCategory: SKIP_CATEGORY.ENV,
      category: ERROR_CATEGORY.BRIDGE_MISSING,
      safeMessage: SAFE_MESSAGES.BRIDGE_MISSING,
    }
  }
  if (!method || typeof services[method] !== 'function') {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.METHOD_MISSING,
      skipCategory: SKIP_CATEGORY.ENV,
      category: ERROR_CATEGORY.METHOD_MISSING,
      safeMessage: SAFE_MESSAGES.METHOD_MISSING,
    }
  }

  if (engine === 'deepl' && isBlank(settings.deeplApiKey)) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  if (engine === 'deeplx' && isBlank(settings.deeplxServerUrl)) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  if (engine === 'thirdparty-ai' && !hasReadyThirdpartyAiGroup(settings, env)) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  if (engine === 'baidu' && (isBlank(settings.baiduAppId) || isBlank(settings.baiduSecret))) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  if (engine === 'aliyun' && (isBlank(settings.aliyunAccessKeyId) || isBlank(settings.aliyunAccessKeySecret))) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  if (engine === 'caiyun' && isBlank(settings.caiyunToken)) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }

  return { status: 'ready' }
}

export function countEngineChars(text) {
  // 按 Unicode 字符而不是 UTF-16 代码单元计数；包含空格、标点与换行。
  return Array.from(String(text == null ? '' : text)).length
}

function inputLimitSkip() {
  return {
    status: 'skipped',
    skipReason: SKIP_REASON.INPUT_LIMIT,
    skipCategory: SKIP_CATEGORY.INPUT,
    category: ERROR_CATEGORY.INPUT_LIMIT,
    safeMessage: SAFE_MESSAGES.INPUT_LIMIT,
  }
}

/**
 * 请求前本地超长预检：超过官方单次上限则跳过且不发请求。
 * 无上限的引擎（含彩云）直接 ready。
 */
export function inspectEngineInputLimit(engine, text) {
  const limit = ENGINE_CHAR_LIMITS[engine]
  if (!limit) return { status: 'ready' }
  if (countEngineChars(text) > limit) return inputLimitSkip()
  return { status: 'ready' }
}

export function inspectEngineForCall(engine, settings = {}, env = getRuntimeEnv(), text) {
  const inspection = inspectEngine(engine, settings, env)
  if (inspection.status === 'skipped') return inspection
  return inspectEngineInputLimit(engine, text)
}

function extractStatusCode(err, raw) {
  const fromField = Number(err && (err.statusCode || err.status))
  if (Number.isFinite(fromField) && fromField >= 100 && fromField <= 599) return fromField
  const httpMatch = raw.match(/\bHTTP\s+(\d{3})\b/i) || raw.match(/\b(\d{3})\s+status code\b/i)
  if (httpMatch) return Number(httpMatch[1])
  if (/\b524\b/.test(raw)) return 524
  return null
}

function withGoogleDiagnostics(result, err) {
  const attempts = sanitizeGoogleAttempts(err && err.googleAttempts)
  if (attempts.length) result.googleAttempts = attempts
  const last = attempts.length ? attempts[attempts.length - 1] : null
  if (last && last.source) result.source = last.source
  else if (err && (err.source === 'library' || err.source === 'gtx' || err.source === 'clients5')) {
    result.source = err.source
  }
  if (last && last.route) result.route = last.route
  else if (err && (err.route === 'proxy' || err.route === 'direct')) {
    result.route = err.route
  }
  if (last && last.durationMs != null) result.durationMs = last.durationMs
  else if (Number.isFinite(Number(err && err.durationMs))) {
    result.durationMs = Math.min(60000, Math.max(0, Math.round(Number(err.durationMs))))
  }
  if (attempts.some((item) => item.route === 'proxy')) {
    const base = result.safeMessage || SAFE_MESSAGES.UNKNOWN
    if (!base.includes('自填代理')) {
      result.safeMessage = base.replace(/。?$/, '') + '。可检查自填代理或切换其他引擎'
    }
  }
  return result
}

export function classifyError(err) {
  const raw = err == null
    ? ''
    : (err && err.message != null ? String(err.message) : String(err))
  const statusCode = extractStatusCode(err, raw)
  const tagged = err && err.category

  let result
  if (statusCode === 524 || /\b524\b/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.STATUS_524,
      statusCode: 524,
      safeMessage: SAFE_MESSAGES.STATUS_524,
    }
  } else if ([
    ERROR_CATEGORY.AUTH_ERROR,
    ERROR_CATEGORY.QUOTA_ERROR,
    ERROR_CATEGORY.RATE_LIMIT,
    ERROR_CATEGORY.BUSINESS_ERROR,
  ].includes(tagged)) {
    result = {
      category: tagged,
      statusCode,
      safeMessage: SAFE_MESSAGES[tagged.toUpperCase()],
    }
  } else if (tagged === ERROR_CATEGORY.PROXY_CONNECT || /代理连接失败/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.PROXY_CONNECT,
      statusCode,
      safeMessage: SAFE_MESSAGES.PROXY_CONNECT,
    }
  } else if (statusCode) {
    result = {
      category: ERROR_CATEGORY.HTTP_ERROR,
      statusCode,
      safeMessage: `引擎返回 HTTP ${statusCode}`,
    }
  } else if (/超时|timeout/i.test(raw)) {
    result = {
      category: ERROR_CATEGORY.TIMEOUT,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.TIMEOUT,
    }
  } else if (/无法解析|解析失败/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.PARSE_ERROR,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.PARSE_ERROR,
    }
  } else if (/空结果|空译文/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.EMPTY_RESULT,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.EMPTY_RESULT,
    }
  } else if (tagged === ERROR_CATEGORY.NETWORK_ERROR || /网络请求失败/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.NETWORK_ERROR,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.NETWORK_ERROR,
    }
  } else if (/翻译服务未加载|桥接/.test(raw)) {
    result = {
      category: ERROR_CATEGORY.BRIDGE_MISSING,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.BRIDGE_MISSING,
    }
  } else {
    result = {
      category: ERROR_CATEGORY.UNKNOWN,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.UNKNOWN,
    }
  }
  return withGoogleDiagnostics(result, err)
}

export function skipUserMessage(inspection) {
  if (!inspection) return SAFE_MESSAGES.UNKNOWN
  if (inspection.skipReason === SKIP_REASON.BRIDGE_MISSING) return SAFE_MESSAGES.RELOAD_HINT
  if (inspection.skipReason === SKIP_REASON.NOT_CONFIGURED) {
    return '该引擎未配置必要凭据或地址，请先在设置中填写。'
  }
  if (inspection.skipReason === SKIP_REASON.INPUT_LIMIT) {
    return SAFE_MESSAGES.INPUT_LIMIT
  }
  if (inspection.skipReason === SKIP_REASON.METHOD_MISSING) {
    return '翻译服务方法不可用。请重载插件，或确认安装的是最新版本后重新安装。'
  }
  return inspection.safeMessage || SAFE_MESSAGES.UNKNOWN
}

/**
 * 全部失败时的可操作归因摘要：优先共同阻断（桥接未加载 / 均未配置）。
 */
export function buildAllFailedMessage(outcomes) {
  if (!outcomes || outcomes.length === 0) {
    return '没有可尝试的翻译引擎，请检查设置。'
  }

  const skipped = outcomes.filter(o => o.status === 'skipped')
  const failures = outcomes.filter(o => o.status === 'failure')
  const envSkips = skipped.filter(o => o.skipCategory === SKIP_CATEGORY.ENV)
  const configSkips = skipped.filter(o => o.skipCategory === SKIP_CATEGORY.CONFIG)
  const inputSkips = skipped.filter(o => o.skipCategory === SKIP_CATEGORY.INPUT)
  const preloadOutcomes = outcomes.filter(o => o.engine !== 'ai')
  const allPreloadBridge = preloadOutcomes.length > 0 && preloadOutcomes.every(
    o => o.status === 'skipped' && o.skipReason === SKIP_REASON.BRIDGE_MISSING
  )

  const failNames = failures.map((f) => {
    const name = engineDisplayName(f.engine)
    return f.statusCode ? `${name}（${f.statusCode}）` : name
  })

  if (allPreloadBridge && failures.length === 0) {
    return SAFE_MESSAGES.RELOAD_HINT
  }
  if (allPreloadBridge && failures.length > 0) {
    return `${failNames.join('、')}调用失败；其余引擎因翻译服务未加载已跳过。请重载插件或检查安装版本。`
  }

  if (failures.length === 0 && skipped.length === outcomes.length) {
    if (configSkips.length === skipped.length) {
      return '没有已配置的可用引擎。请在设置中填写必要的 Key 或服务器地址后再试。'
    }
    if (envSkips.length === skipped.length) {
      return SAFE_MESSAGES.RELOAD_HINT
    }
    if (inputSkips.length === skipped.length) {
      return SAFE_MESSAGES.INPUT_LIMIT
    }
    if (inputSkips.length) {
      return `${SAFE_MESSAGES.INPUT_LIMIT}，其余引擎不可用。请检查设置后再试。`
    }
    return '所有引擎均已跳过。请检查设置、重载插件后再试。'
  }

  if (failures.length > 0) {
    const names = failNames.join('、')
    const inputHint = inputSkips.length ? `${SAFE_MESSAGES.INPUT_LIMIT}；` : ''
    if (configSkips.length && envSkips.length === 0) {
      return `${inputHint}${names}调用失败，其余引擎未配置。请稍后重试或在设置中补充配置。`
    }
    return `${inputHint}可用引擎均调用失败（${names}）。请稍后重试或更换引擎。`
  }

  return '所有引擎均不可用。请检查设置后重试。'
}

function resolveEngineTimeoutMs(timeoutMs) {
  const n = Number(timeoutMs)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_ENGINE_TIMEOUT_MS
  return n
}

function hasUsableTranslation(result) {
  return !!(result && typeof result === 'object' && typeof result.translation === 'string' && result.translation.trim())
}

/**
 * 自定义 AI 不套一级截止计时器。调用方（组链）必须自行按组超时并始终结算。
 * 仍校验可用译文，并吞掉未处理拒绝。
 */
function callThirdpartyAiWithoutPrimaryTimeout(translateWith, engine) {
  const callPromise = Promise.resolve().then(() => translateWith(engine))
  callPromise.catch(() => {})
  return callPromise.then((result) => {
    if (!hasUsableTranslation(result)) {
      throw new Error('引擎返回空结果')
    }
    return result
  })
}

/**
 * 一次引擎尝试：调用 Promise 与截止计时器竞争，只结算一次。
 * 迟到的 resolve/reject 被吞掉，避免重复统计与未处理拒绝。
 */
export function attemptEngineCall(translateWith, engine, timeoutMs) {
  const budget = resolveEngineTimeoutMs(timeoutMs)
  let settled = false
  let timer = null
  const callPromise = Promise.resolve().then(() => translateWith(engine))
  callPromise.catch(() => {})

  const wrapped = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('引擎请求超时'))
    }, budget)

    callPromise.then(
      (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!hasUsableTranslation(result)) {
          reject(new Error('引擎返回空结果'))
          return
        }
        resolve(result)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    )
  })

  return wrapped.finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * 按 failoverOrder 依次尝试。跳过不发请求；524 计为失败并立即尝试下一引擎。
 * 每个已调用引擎有独立时限，超时视为真实失败且不重试同一引擎。
 * 请求令牌通过 isCurrent() 覆盖跳过、成功、失败与异步返回。
 */
export async function runEngineFailover({
  order,
  settings,
  env,
  translateWith,
  isCurrent,
  onSkip,
  onFailure,
  onSuccess,
  timeoutMs,
  text,
}) {
  const outcomes = []
  const list = Array.isArray(order) && order.length > 0 ? order : ['ai']
  const runtime = env || getRuntimeEnv()
  const budget = resolveEngineTimeoutMs(timeoutMs)
  let bridgeMissingNotified = false

  for (let i = 0; i < list.length; i++) {
    if (typeof isCurrent === 'function' && !isCurrent()) {
      return { stale: true, outcomes }
    }
    const engine = list[i]
    const inspection = inspectEngineForCall(engine, settings, runtime, text)
    if (inspection.status === 'skipped') {
      const notifyOnce = inspection.skipReason === SKIP_REASON.BRIDGE_MISSING && !bridgeMissingNotified
      outcomes.push({ engine, status: 'skipped', ...inspection })
      onSkip?.(engine, inspection, { notifyOnce, index: i })
      if (inspection.skipReason === SKIP_REASON.BRIDGE_MISSING) bridgeMissingNotified = true
      continue
    }

    try {
      // 自定义 AI 组链自管二级时限，不能被一级 timeoutMs 截断整条组链。
      const result = engine === 'thirdparty-ai'
        ? await callThirdpartyAiWithoutPrimaryTimeout(translateWith, engine)
        : await attemptEngineCall(translateWith, engine, budget)
      if (typeof isCurrent === 'function' && !isCurrent()) {
        return { stale: true, outcomes }
      }
      outcomes.push({ engine, status: 'success' })
      onSuccess?.(engine, result, i)
      return {
        stale: false,
        success: true,
        engine,
        result,
        outcomes,
        fallback: i > 0,
        primaryEngine: list[0],
      }
    } catch (err) {
      if (typeof isCurrent === 'function' && !isCurrent()) {
        return { stale: true, outcomes }
      }
      const classified = classifyError(err)
      outcomes.push({ engine, status: 'failure', ...classified })
      onFailure?.(engine, classified)
    }
  }

  return {
    stale: false,
    success: false,
    outcomes,
    message: buildAllFailedMessage(outcomes),
  }
}

/**
 * 词典为可选能力：桥接缺失或查询失败时返回空结果，不破坏已成功的主译文。
 */
export async function safeLookupWord(word, env = getRuntimeEnv()) {
  const trimmed = (word || '').trim()
  if (!trimmed || /\s+/.test(trimmed)) return { ...EMPTY_DICT }
  if (!hasServiceMethod('lookupWord', env)) return { ...EMPTY_DICT }
  try {
    const result = await env.services.lookupWord(trimmed)
    if (!result || typeof result !== 'object') return { ...EMPTY_DICT }
    return {
      phonetic: result.phonetic || '',
      definitions: Array.isArray(result.definitions) ? result.definitions : [],
      examples: Array.isArray(result.examples) ? result.examples : [],
    }
  } catch {
    return { ...EMPTY_DICT }
  }
}

/**
 * 只取主译文。词典不得参与引擎级结算，避免慢查询拖垮超时与回退。
 */
export async function runMainTextTranslation(translateFn, text, from, to) {
  const translation = await translateFn(text, from, to)
  if (!translation || !String(translation).trim()) {
    throw new Error('引擎返回空结果')
  }
  return { translation: String(translation) }
}

/** 单词模式的词典查询词：英译中查原文，中译英查译文；句子不查。 */
export function wordLookupTarget({ type, lang, sourceText, translation }) {
  if (type === 'sentence') return null
  if (lang === 'en') {
    const t = (sourceText || '').trim()
    return t || null
  }
  const t = (translation || '').trim()
  return t || null
}

/**
 * 词典晚到补充：仅当仍是同一请求、同一成功引擎、同一主译文时才可合并。
 */
export function canApplyDictionarySupplement({
  isCurrent,
  engine,
  usedEngine,
  translation,
  currentTranslation,
}) {
  if (typeof isCurrent === 'function' && !isCurrent()) return false
  if (!engine || engine !== usedEngine) return false
  if (!translation || translation !== currentTranslation) return false
  return true
}
