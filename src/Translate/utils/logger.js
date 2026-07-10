/**
 * 翻译日志模块
 *
 * 用途：仅保存最近的操作日志，便于用户在翻译失败时查看报错、复制后提 issue。
 * 不做大容量存储——按等级过滤 + 按保留天数裁剪 + 按最大条数封顶。
 *
 * 日志条目结构：
 *   { id, timestamp, level, engine, message, detail }
 *   - level:    'debug' | 'info' | 'warn' | 'error'
 *   - engine:   引擎标识（'ai' | 'thirdparty-ai' | 'google' | 'deepl' | 'deeplx' | 'system'）
 *   - message:  人读消息
 *   - detail:   可选附加信息（如错误堆栈、请求参数摘要），字符串
 */

import { LOG_STORAGE_KEY, MAX_LOG_COUNT, LOG_LEVELS, levelLabel } from './logConstants.js'

/**
 * 直接从 dbStorage 读取日志等级与保留天数（不依赖响应式，避免循环依赖）
 * 读不到时回退默认值：等级=error，保留=7 天
 */
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

/** 当前等级是否达到记录阈值 */
function shouldLog(level) {
  const { logLevel } = readLogConfig()
  const threshold = LOG_LEVELS[logLevel] ?? LOG_LEVELS.error
  return (LOG_LEVELS[level] ?? LOG_LEVELS.info) >= threshold
}

/** 读取现有日志 */
function readLogs() {
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

/** 写入日志（含保留天数裁剪 + 最大条数封顶） */
function writeLogs(logs) {
  const { logRetentionDays } = readLogConfig()
  let pruned = logs

  // 按保留天数裁剪：0 表示永久保留
  if (logRetentionDays && logRetentionDays > 0) {
    const cutoff = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000
    pruned = pruned.filter(e => e.timestamp >= cutoff)
  }

  // 最大条数封顶：保留最新 MAX_LOG_COUNT 条
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

/**
 * 添加一条日志
 * @param {string} level   - 等级
 * @param {string} engine   - 引擎标识
 * @param {string} message  - 消息
 * @param {string|object} [detail] - 附加信息，对象会被序列化
 */
export function addLog(level, engine, message, detail) {
  if (!shouldLog(level)) return
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    timestamp: Date.now(),
    level,
    engine: engine || 'system',
    message: String(message || ''),
    detail: detail == null ? ''
      : typeof detail === 'string' ? detail
      : (() => { try { return JSON.stringify(detail) } catch (e) { return String(detail) } })()
  }
  const logs = readLogs()
  logs.push(entry)
  writeLogs(logs)
}

/** 便捷方法 */
export const logger = {
  debug: (engine, message, detail) => addLog('debug', engine, message, detail),
  info: (engine, message, detail) => addLog('info', engine, message, detail),
  warn: (engine, message, detail) => addLog('warn', engine, message, detail),
  error: (engine, message, detail) => addLog('error', engine, message, detail),
}

/** 获取全部日志（新→旧） */
export function getLogs() {
  return readLogs().slice().reverse()
}

/** 清空全部日志 */
export function clearLogs() {
  try {
    window.utools.dbStorage.setItem(LOG_STORAGE_KEY, [])
  } catch (e) {
    // 静默
  }
}

/** 日志条数 */
export function getLogCount() {
  return readLogs().length
}

/** 把日志格式化为可复制的纯文本（便于贴 issue） */
export function formatLogsText() {
  const logs = readLogs()
  if (logs.length === 0) return '（暂无日志）'
  const lines = logs.map(e => {
    const time = new Date(e.timestamp).toLocaleString('zh-CN', { hour12: false })
    const lv = (levelLabel(e.level) || e.level).padEnd(2)
    const eng = (e.engine || '').padEnd(12)
    const head = `[${time}] [${lv}] [${eng}] ${e.message}`
    return e.detail ? `${head}\n  详情: ${e.detail}` : head
  })
  return lines.join('\n')
}

export { LOG_LEVELS, levelLabel }