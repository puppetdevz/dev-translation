/**
 * 翻译引擎桥接检查、故障分类与故障转移调度。
 * 纯逻辑：window / 服务通过参数注入，便于隔离测试。
 */

export const ENGINE_DISPLAY_NAMES = {
  ai: 'uTools AI',
  'thirdparty-ai': '自定义 AI',
  google: 'Google 翻译',
  deepl: 'DeepL 官方',
  deeplx: 'DeepLX 自部署',
}

export const PRELOAD_METHODS = {
  google: 'googleTranslate',
  deepl: 'deeplTranslate',
  deeplx: 'deeplxTranslate',
  'thirdparty-ai': 'requestThirdpartyAI',
}

export const SKIP_REASON = {
  BRIDGE_MISSING: 'bridge_missing',
  METHOD_MISSING: 'method_missing',
  NOT_CONFIGURED: 'not_configured',
}

export const SKIP_CATEGORY = {
  ENV: 'env',
  CONFIG: 'config',
}

export const ERROR_CATEGORY = {
  STATUS_524: 'status_524',
  BRIDGE_MISSING: 'bridge_missing',
  METHOD_MISSING: 'method_missing',
  NOT_CONFIGURED: 'not_configured',
  HTTP_ERROR: 'http_error',
  TIMEOUT: 'timeout',
  PARSE_ERROR: 'parse_error',
  EMPTY_RESULT: 'empty_result',
  UNKNOWN: 'unknown',
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

export const SAFE_MESSAGES = {
  STATUS_524: '上游返回 524（无响应体）',
  BRIDGE_MISSING: '翻译服务未加载',
  METHOD_MISSING: '翻译服务方法不可用',
  NOT_CONFIGURED: '引擎未配置必要凭据或地址',
  HTTP_ERROR: '引擎返回 HTTP 错误',
  TIMEOUT: '引擎请求超时',
  PARSE_ERROR: '翻译结果解析失败',
  EMPTY_RESULT: '引擎返回空结果',
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
  if (engine === 'thirdparty-ai' && (isBlank(settings.thirdpartyAiUrl) || isBlank(settings.thirdpartyAiModel))) {
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

function extractStatusCode(err, raw) {
  const fromField = Number(err && (err.statusCode || err.status))
  if (Number.isFinite(fromField) && fromField >= 100 && fromField <= 599) return fromField
  const httpMatch = raw.match(/\bHTTP\s+(\d{3})\b/i) || raw.match(/\b(\d{3})\s+status code\b/i)
  if (httpMatch) return Number(httpMatch[1])
  if (/\b524\b/.test(raw)) return 524
  return null
}

export function classifyError(err) {
  const raw = err == null
    ? ''
    : (err && err.message != null ? String(err.message) : String(err))
  const statusCode = extractStatusCode(err, raw)

  if (statusCode === 524 || /\b524\b/.test(raw)) {
    return {
      category: ERROR_CATEGORY.STATUS_524,
      statusCode: 524,
      safeMessage: SAFE_MESSAGES.STATUS_524,
    }
  }
  if (statusCode) {
    return {
      category: ERROR_CATEGORY.HTTP_ERROR,
      statusCode,
      safeMessage: `引擎返回 HTTP ${statusCode}`,
    }
  }
  if (/超时|timeout/i.test(raw)) {
    return {
      category: ERROR_CATEGORY.TIMEOUT,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.TIMEOUT,
    }
  }
  if (/无法解析|解析失败/.test(raw)) {
    return {
      category: ERROR_CATEGORY.PARSE_ERROR,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.PARSE_ERROR,
    }
  }
  if (/空结果|空译文/.test(raw)) {
    return {
      category: ERROR_CATEGORY.EMPTY_RESULT,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.EMPTY_RESULT,
    }
  }
  if (/翻译服务未加载|桥接/.test(raw)) {
    return {
      category: ERROR_CATEGORY.BRIDGE_MISSING,
      statusCode: null,
      safeMessage: SAFE_MESSAGES.BRIDGE_MISSING,
    }
  }
  return {
    category: ERROR_CATEGORY.UNKNOWN,
    statusCode: null,
    safeMessage: SAFE_MESSAGES.UNKNOWN,
  }
}

export function skipUserMessage(inspection) {
  if (!inspection) return SAFE_MESSAGES.UNKNOWN
  if (inspection.skipReason === SKIP_REASON.BRIDGE_MISSING) return SAFE_MESSAGES.RELOAD_HINT
  if (inspection.skipReason === SKIP_REASON.NOT_CONFIGURED) {
    return '该引擎未配置必要凭据或地址，请先在设置中填写。'
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
    return '所有引擎均已跳过。请检查设置、重载插件后再试。'
  }

  if (failures.length > 0) {
    const names = failNames.join('、')
    if (configSkips.length && envSkips.length === 0) {
      return `${names}调用失败，其余引擎未配置。请稍后重试或在设置中补充配置。`
    }
    return `可用引擎均调用失败（${names}）。请稍后重试或更换引擎。`
  }

  return '所有引擎均不可用。请检查设置后重试。'
}

/**
 * 按 failoverOrder 依次尝试。跳过不发请求；524 计为失败并立即尝试下一引擎。
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
}) {
  const outcomes = []
  const list = Array.isArray(order) && order.length > 0 ? order : ['ai']
  const runtime = env || getRuntimeEnv()
  let bridgeMissingNotified = false

  for (let i = 0; i < list.length; i++) {
    if (typeof isCurrent === 'function' && !isCurrent()) {
      return { stale: true, outcomes }
    }
    const engine = list[i]
    const inspection = inspectEngine(engine, settings, runtime)
    if (inspection.status === 'skipped') {
      const notifyOnce = inspection.skipReason === SKIP_REASON.BRIDGE_MISSING && !bridgeMissingNotified
      outcomes.push({ engine, status: 'skipped', ...inspection })
      onSkip?.(engine, inspection, { notifyOnce, index: i })
      if (inspection.skipReason === SKIP_REASON.BRIDGE_MISSING) bridgeMissingNotified = true
      continue
    }

    try {
      const result = await translateWith(engine)
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
