/**
 * 翻译日志模块
 *
 * 用途：仅保存最近的操作日志，便于用户在翻译失败时查看报错、复制后提 issue。
 * 新日志只保留最少元数据（引擎、错误类别、状态码、阶段、请求序号/时间），
 * 不保存原文、prompt、请求体、凭据、URL、响应正文或原始堆栈。
 */

import { LOG_STORAGE_KEY, MAX_LOG_COUNT, LOG_LEVELS, levelLabel } from './logConstants.js'
import { sanitizeLogEntry, sanitizeLogList, logsNeedMigration, formatSafeLogLine } from './safeLog.js'

function readLogConfig() {
  let logLevel = 'error'
  let logRetentionDays = 7
  try {
    const raw = window.utools.dbStorage.getItem('dev-translation-settings')
    if (typeof raw === 'string' && raw) {
      const s = JSON.parse(raw)
      if (s.logLevel && LOG_LEVELS[s.logLevel] !== undefined) logLevel = s.logLevel
      if (typeof s.logRetentionDays === 'number') logRetentionDays = s.logRetentionDays
    }
  } catch (e) {
    // 静默回退
  }
  return { logLevel, logRetentionDays }
}

function shouldLog(level) {
  const { logLevel } = readLogConfig()
  const threshold = LOG_LEVELS[logLevel] ?? LOG_LEVELS.error
  return (LOG_LEVELS[level] ?? LOG_LEVELS.info) >= threshold
}

function readRawLogs() {
  try {
    const raw = window.utools.dbStorage.getItem(LOG_STORAGE_KEY)
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string' && raw) {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    }
  } catch (e) {
    // 静默
  }
  return []
}

function persistLogs(logs) {
  const { logRetentionDays } = readLogConfig()
  let pruned = logs

  if (logRetentionDays && logRetentionDays > 0) {
    const cutoff = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000
    pruned = pruned.filter(e => e.timestamp >= cutoff)
  }

  if (pruned.length > MAX_LOG_COUNT) {
    pruned = pruned.slice(pruned.length - MAX_LOG_COUNT)
  }

  try {
    window.utools.dbStorage.setItem(LOG_STORAGE_KEY, pruned)
  } catch (e) {
    // 静默
  }
  return pruned
}

/** 读取并在必要时迁移清理旧的敏感明细 */
function readLogs() {
  const raw = readRawLogs()
  const sanitized = sanitizeLogList(raw)
  if (logsNeedMigration(raw, sanitized)) {
    return persistLogs(sanitized)
  }
  return sanitized
}

/**
 * 添加一条安全日志。extra 仅白名单字段会保留。
 * @param {string} level
 * @param {string} engine
 * @param {string} message
 * @param {object} [extra]
 */
export function addLog(level, engine, message, extra) {
  if (!shouldLog(level)) return
  const meta = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}
  const entry = sanitizeLogEntry({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    timestamp: Date.now(),
    level,
    engine: engine || 'system',
    message: String(message || ''),
    category: meta.category,
    statusCode: meta.statusCode,
    phase: meta.phase,
    requestId: meta.requestId,
    skipReason: meta.skipReason,
    skipCategory: meta.skipCategory,
    groupId: meta.groupId,
    groupIndex: meta.groupIndex,
    source: meta.source,
    route: meta.route,
    durationMs: meta.durationMs,
    googleAttempts: meta.googleAttempts,
  })
  if (!entry) return
  const logs = readLogs()
  logs.push(entry)
  persistLogs(logs)
}

export const logger = {
  debug: (engine, message, extra) => addLog('debug', engine, message, extra),
  info: (engine, message, extra) => addLog('info', engine, message, extra),
  warn: (engine, message, extra) => addLog('warn', engine, message, extra),
  error: (engine, message, extra) => addLog('error', engine, message, extra),
}

export function getLogs() {
  return readLogs().slice().reverse()
}

export function clearLogs() {
  try {
    window.utools.dbStorage.setItem(LOG_STORAGE_KEY, [])
  } catch (e) {
    // 静默
  }
}

export function getLogCount() {
  return readLogs().length
}

export function formatLogsText() {
  const logs = readLogs()
  if (logs.length === 0) return '（暂无日志）'
  const lines = logs.map(e => {
    const time = new Date(e.timestamp).toLocaleString('zh-CN', { hour12: false })
    return formatSafeLogLine(e, time, levelLabel(e.level) || e.level)
  })
  return lines.join('\n')
}

export { LOG_LEVELS, levelLabel }
