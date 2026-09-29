/**
 * 日志最少元数据白名单与历史记录安全清理。
 * 不依赖 uTools，便于隔离测试。
 */

const ALLOWED_LEVELS = { debug: true, info: true, warn: true, error: true }

const ALLOWED_CATEGORY = {
  status_524: true,
  bridge_missing: true,
  method_missing: true,
  not_configured: true,
  http_error: true,
  timeout: true,
  parse_error: true,
  empty_result: true,
  unknown: true,
}

const ALLOWED_PHASE = {
  call: true,
  skip: true,
  parse: true,
  fallback: true,
  test: true,
  lookup: true,
}

const ALLOWED_SKIP_REASON = {
  bridge_missing: true,
  method_missing: true,
  not_configured: true,
}

const SENSITIVE_RE = /sk-[a-zA-Z0-9]|Bearer\s+\S+|DeepL-Auth-Key|api[_-]?key|authorization|password|token=/i
const URL_QUERY_RE = /https?:\/\/[^\s]+[?&]/i
const JSONISH_RE = /[{[][\s\S]*[}\]]/
const PROMPT_RE = /prompt|messages\s*[:=]|request body|response body|原文/i

function isUnsafeMessage(msg) {
  if (typeof msg !== 'string') return true
  if (!msg) return false
  if (msg.length > 180) return true
  if (SENSITIVE_RE.test(msg)) return true
  if (URL_QUERY_RE.test(msg)) return true
  if (JSONISH_RE.test(msg)) return true
  if (PROMPT_RE.test(msg)) return true
  if (/at\s+\S+\s+\(/.test(msg) || /TypeError:/.test(msg) || /Cannot read properties/.test(msg)) return true
  return false
}

function categoryFallbackMessage(category, statusCode) {
  if (category === 'status_524') return '上游返回 524（无响应体）'
  if (category === 'bridge_missing') return '翻译服务未加载'
  if (category === 'method_missing') return '翻译服务方法不可用'
  if (category === 'not_configured') return '引擎未配置必要凭据或地址'
  if (category === 'http_error') {
    return Number.isFinite(Number(statusCode)) ? `引擎返回 HTTP ${Number(statusCode)}` : '引擎返回 HTTP 错误'
  }
  if (category === 'timeout') return '引擎请求超时'
  if (category === 'parse_error') return '翻译结果解析失败'
  if (category === 'empty_result') return '引擎返回空结果'
  return '已记录一次安全诊断事件'
}

function pickFiniteStatus(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 100 || n > 599) return null
  return n
}

/**
 * 将任意历史/新日志条目收敛为白名单字段。
 * 无法确信脱敏彻底的 detail / 原始 message 直接丢弃。
 */
export function sanitizeLogEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null

  const level = ALLOWED_LEVELS[entry.level] ? entry.level : 'error'
  const engine = typeof entry.engine === 'string' && entry.engine ? entry.engine : 'system'
  const category = ALLOWED_CATEGORY[entry.category] ? entry.category : undefined
  const statusCode = pickFiniteStatus(entry.statusCode)
  const phase = ALLOWED_PHASE[entry.phase] ? entry.phase : undefined
  const skipReason = ALLOWED_SKIP_REASON[entry.skipReason] ? entry.skipReason : undefined
  const skipCategory = (entry.skipCategory === 'env' || entry.skipCategory === 'config')
    ? entry.skipCategory
    : undefined
  const requestId = Number.isFinite(Number(entry.requestId)) ? Number(entry.requestId) : undefined
  const groupId = typeof entry.groupId === 'string' && /^g_[a-z0-9_]+$/i.test(entry.groupId)
    ? entry.groupId
    : undefined
  const groupIndex = Number.isInteger(entry.groupIndex) && entry.groupIndex >= 0 && entry.groupIndex < 1000
    ? entry.groupIndex
    : undefined

  let message = ''
  if (typeof entry.message === 'string' && entry.message && !isUnsafeMessage(entry.message)) {
    message = entry.message
  } else {
    message = categoryFallbackMessage(category, statusCode)
  }

  const out = {
    id: typeof entry.id === 'string' && entry.id ? entry.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    level,
    engine,
    message,
  }
  if (category) out.category = category
  if (statusCode != null) out.statusCode = statusCode
  if (phase) out.phase = phase
  if (requestId != null) out.requestId = requestId
  if (skipReason) out.skipReason = skipReason
  if (skipCategory) out.skipCategory = skipCategory
  if (groupId) out.groupId = groupId
  if (groupIndex != null) out.groupIndex = groupIndex
  return out
}

export function sanitizeLogList(logs) {
  if (!Array.isArray(logs)) return []
  return logs.map(sanitizeLogEntry).filter(Boolean)
}

export function logsNeedMigration(rawLogs, sanitized) {
  if (!Array.isArray(rawLogs)) return Array.isArray(sanitized) && sanitized.length >= 0
  if (rawLogs.length !== sanitized.length) return true
  for (let i = 0; i < rawLogs.length; i++) {
    const a = rawLogs[i]
    const b = sanitized[i]
    if (!a || typeof a !== 'object') return true
    if (Object.prototype.hasOwnProperty.call(a, 'detail')) return true
    if (a.message !== b.message || a.category !== b.category || a.statusCode !== b.statusCode) return true
    if (a.level !== b.level || a.engine !== b.engine) return true
  }
  return false
}

export function formatSafeLogLine(entry, timeText, levelText) {
  const time = timeText || ''
  const lv = String(levelText || entry.level || '').padEnd(2)
  const eng = String(entry.engine || '').padEnd(12)
  const parts = [`[${time}] [${lv}] [${eng}] ${entry.message || ''}`]
  const meta = []
  if (entry.category) meta.push(`类别=${entry.category}`)
  if (entry.statusCode != null) meta.push(`状态=${entry.statusCode}`)
  if (entry.phase) meta.push(`阶段=${entry.phase}`)
  if (entry.requestId != null) meta.push(`请求=${entry.requestId}`)
  if (entry.skipReason) meta.push(`跳过=${entry.skipReason}`)
  if (entry.groupId) meta.push(`组=${entry.groupId}`)
  if (entry.groupIndex != null) meta.push(`组序号=${entry.groupIndex}`)
  if (meta.length) parts.push(`  元数据: ${meta.join(' ')}`)
  return parts.join('\n')
}
