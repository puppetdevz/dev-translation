/**
 * 日志模块常量
 * 单独抽出以便 logger.js 与 UI 层共享，且便于未来调整
 */

// 日志存储 key（独立于设置 key，避免设置体积膨胀）
export const LOG_STORAGE_KEY = 'dev-translation-logs'

// 最大保留条数：封顶，防止无限增长。用户诉求是"仅需最近失败日志"，100 条足够
export const MAX_LOG_COUNT = 100

// 等级权重：数值越大优先级越高，用于等级过滤（>= 阈值才记录）
export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

// 等级中文标签（用于 UI 展示与复制格式化）
const LEVEL_LABELS = { debug: '调试', info: '信息', warn: '警告', error: '错误' }

/** 等级中文标签，未知等级回退原值 */
export const levelLabel = (level) => LEVEL_LABELS[level] || level

// 可选日志等级列表（SettingsPage 下拉用），按权重升序
export const LOG_LEVEL_OPTIONS = [
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'error', label: '错误' },
]

// 可选保留天数（SettingsPage 下拉用），不提供永久选项：日志仅用于排查近期问题
export const LOG_RETENTION_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' },
]