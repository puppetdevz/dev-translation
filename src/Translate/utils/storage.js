/**
 * 翻译输出设置存储工具
 * 使用 uTools dbStorage API 实现持久化
 */

import {
  defaultThirdpartyAiGroups,
  migrateLegacyThirdpartyAiGroup,
  normalizeThirdpartyAiGroups,
  cloneGroups,
  stripLegacyThirdpartyAiFields,
} from './thirdpartyAiGroups.js'

const STORAGE_KEY = 'dev-translation-settings'

export const ENGINE_RESPONSE_TIMEOUT_MIN = 1
export const ENGINE_RESPONSE_TIMEOUT_MAX = 60
export const ENGINE_RESPONSE_TIMEOUT_DEFAULT = 5

/**
 * 翻译引擎响应超时（秒）：仅接受 1–60 的整数。
 * 空值、小数、非数字、0、负数、越界一律回退默认 5 秒，避免无效值进入 timer。
 */
export function normalizeEngineResponseTimeoutSeconds(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^[+-]?\d+$/.test(trimmed)) return ENGINE_RESPONSE_TIMEOUT_DEFAULT
    value = Number(trimmed)
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    return ENGINE_RESPONSE_TIMEOUT_DEFAULT
  }
  if (value < ENGINE_RESPONSE_TIMEOUT_MIN || value > ENGINE_RESPONSE_TIMEOUT_MAX) {
    return ENGINE_RESPONSE_TIMEOUT_DEFAULT
  }
  return value
}

export function snapshotEngineTimeoutMs(settings) {
  return normalizeEngineResponseTimeoutSeconds(settings && settings.engineResponseTimeoutSeconds) * 1000
}

export function snapshotThirdpartyAiTimeoutMs(settings) {
  return normalizeEngineResponseTimeoutSeconds(settings && settings.thirdpartyAiFailoverTimeoutSeconds) * 1000
}

export const GOOGLE_PROXY_ERROR = {
  empty: '启用代理时请填写地址',
  protocol: '仅支持 http:// 或 https:// 的 CONNECT 代理，不支持 SOCKS5',
  credentials: '不支持带用户名密码的代理',
  malformed: '代理地址格式无效',
}

/**
 * 仅接受无用户名密码的 http:// 或 https:// CONNECT 代理。
 * 不把解析失败的原因写成含主机/凭据的句子。
 */
export function parseGoogleProxyUrl(raw) {
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
  }
}

export function googleProxyErrorMessage(reason) {
  return GOOGLE_PROXY_ERROR[reason] || GOOGLE_PROXY_ERROR.malformed
}

export function normalizeGoogleProxySettings(settings) {
  const s = settings || {}
  const parsed = parseGoogleProxyUrl(s.googleProxyUrl)
  const urlToKeep = parsed.ok
    ? parsed.url
    : (s.googleProxyUrl == null ? '' : String(s.googleProxyUrl).trim())
  if (s.googleProxyEnabled !== true) {
    return { googleProxyEnabled: false, googleProxyUrl: urlToKeep }
  }
  if (!parsed.ok) {
    return {
      googleProxyEnabled: false,
      googleProxyUrl: urlToKeep,
      error: parsed.reason,
    }
  }
  return { googleProxyEnabled: true, googleProxyUrl: parsed.url }
}

export function snapshotGoogleProxy(settings) {
  const normalized = normalizeGoogleProxySettings(settings)
  return {
    proxyEnabled: !!normalized.googleProxyEnabled,
    proxyUrl: normalized.googleProxyEnabled ? normalized.googleProxyUrl : '',
  }
}

function cloneSettings(settings) {
  const next = { ...settings }
  if (Array.isArray(settings.failoverOrder)) {
    next.failoverOrder = [...settings.failoverOrder]
  }
  next.thirdpartyAiGroups = cloneGroups(settings.thirdpartyAiGroups || [])
  stripLegacyThirdpartyAiFields(next)
  return next
}

// 默认设置
export const DEFAULT_SETTINGS = {
  showPhonetic: true,           // 显示音标
  showDefinitions: true,        // 显示释义
  showExamples: true,           // 显示例句
  showVariableNaming: true,     // 显示变量命名样式
  showContextNote: true,        // 显示上下文说明
  detectionStrategy: 'regex',   // 语言检测策略: 'regex' | 'ai'
  translationEngine: 'ai',     // 主翻译引擎（兼容旧版本，实际主引擎由 failoverOrder[0] 决定）
  failoverOrder: ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx'], // 自动故障转移顺序: 所有引擎的有序列表，首位为主引擎，翻译失败时按此顺序依次重试。deepl=官方 API，deeplx=自部署/公共实例
  engineResponseTimeoutSeconds: ENGINE_RESPONSE_TIMEOUT_DEFAULT, // 每个已调用翻译引擎取得主译文的时限（秒），超时视为失败并尝试下一引擎
  deeplApiKey: '',              // DeepL 官方 API Key（Free 版以 :fx 结尾，注册地址 https://www.deepl.com/pro-api）
  deeplxServerUrl: '',          // DeepLX 服务器地址（如 http://localhost:1188）
  deeplxToken: '',              // DeepLX 访问令牌（可选，自部署无 token 时留空）
  thirdpartyAiGroups: defaultThirdpartyAiGroups(), // 自定义 AI 二级组：[{ id, name, url, apiKey, model }]，空数组表示零组
  thirdpartyAiFailoverTimeoutSeconds: ENGINE_RESPONSE_TIMEOUT_DEFAULT, // 每个自定义 AI 组各自的二级时限（秒），与一级引擎超时相互独立
  thirdpartyAiSystemPrompt: '',     // 所有自定义 AI 组共用的系统提示词（作为 system role，user role 仍放默认指令）
  logLevel: 'error',                // 日志记录等级: 'debug' | 'info' | 'error'（默认仅记录错误，便于排查翻译失败）
  logRetentionDays: 7,              // 日志保留天数: 1/3/7/0(永久)，到期自动清理；始终受最大条数封顶
  googleProxyEnabled: false,        // Google 专用 HTTP(S) CONNECT 代理，默认关闭
  googleProxyUrl: '',               // 用户自填、无认证的 http:// 或 https:// 代理地址
}

// 已知引擎白名单：loadSettings 会用它过滤 failoverOrder，剔除未知/废弃的引擎标识，防止渲染时 engineMeta[engine] 为 undefined 致白屏
export const KNOWN_ENGINES = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx']

/**
 * 加载设置
 * @returns {Object} 设置对象
 */
export const loadSettings = () => {
  try {
    const stored = window.utools.dbStorage.getItem(STORAGE_KEY)
    // 校验 stored 必须是非空字符串，避免 dbStorage 返回 ''/null/对象时被 JSON.parse 抛错或被 if(stored) 误判
    if (typeof stored === 'string' && stored) {
      const parsed = JSON.parse(stored)
      // 合并默认设置，确保新增字段有默认值。组字段必须看 parsed 是否存在：空数组是合法的零组。
      const merged = { ...DEFAULT_SETTINGS, ...parsed }
      // 兼容旧版本：若没有 failoverOrder，则用原主引擎 + 其他引擎初始化（主引擎首位）
      if (!merged.failoverOrder || !Array.isArray(merged.failoverOrder) || merged.failoverOrder.length === 0) {
        const main = merged.translationEngine || 'ai'
        merged.failoverOrder = [main, ...['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx'].filter(e => e !== main)]
      }
      // 兼容旧 failoverOrder 无 thirdparty-ai：在 ai 之后插入
      if (Array.isArray(merged.failoverOrder) && !merged.failoverOrder.includes('thirdparty-ai')) {
        const aiIdx = merged.failoverOrder.indexOf('ai')
        if (aiIdx >= 0) {
          merged.failoverOrder.splice(aiIdx + 1, 0, 'thirdparty-ai')
        } else {
          merged.failoverOrder.unshift('thirdparty-ai')
        }
      }
      // 白名单过滤：剔除未知引擎标识（防止旧版残留或外部手动写入的未知值导致 SettingsPage 渲染白屏）
      merged.failoverOrder = merged.failoverOrder.filter(e => KNOWN_ENGINES.includes(e))
      // DeepL 引擎拆分迁移：旧版用 deeplMode 区分 official/deeplx，新版拆分为两个独立顶级引擎
      // merged.deeplMode 来自旧配置的 spread（DEFAULT_SETTINGS 已移除该字段，仅作迁移判断用）
      if (Array.isArray(merged.failoverOrder)) {
        if (merged.deeplMode === 'deeplx') {
          // 用户原用 DeepLX：把 failoverOrder 中的 'deepl' 替换为 'deeplx'（保留原优先级位置，避免被当作官方 API 触发"未配置 Key"）
          merged.failoverOrder = merged.failoverOrder.map(e => e === 'deepl' ? 'deeplx' : e)
        }
        // 确保 'deeplx' 在 failoverOrder 中（拆分后新增的引擎）：插入到 'deepl' 之后，无 'deepl' 则追加末尾
        if (!merged.failoverOrder.includes('deeplx')) {
          const deeplIdx = merged.failoverOrder.indexOf('deepl')
          if (deeplIdx >= 0) {
            merged.failoverOrder.splice(deeplIdx + 1, 0, 'deeplx')
          } else {
            merged.failoverOrder.push('deeplx')
          }
        }
        // 确保 'deepl' 也在 failoverOrder 中（deeplMode='deeplx' 替换后可能缺失）：插入到 'deeplx' 之前
        if (!merged.failoverOrder.includes('deepl')) {
          const deeplxIdx = merged.failoverOrder.indexOf('deeplx')
          if (deeplxIdx >= 0) {
            merged.failoverOrder.splice(deeplxIdx, 0, 'deepl')
          } else {
            merged.failoverOrder.push('deepl')
          }
        }
        // 清理废弃字段，避免持久化回写
        delete merged.deeplMode
      }
      // 过滤后若为空，回退默认顺序
      if (merged.failoverOrder.length === 0) {
        merged.failoverOrder = [...DEFAULT_SETTINGS.failoverOrder]
      }
      merged.engineResponseTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
        merged.engineResponseTimeoutSeconds
      )
      merged.thirdpartyAiFailoverTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
        merged.thirdpartyAiFailoverTimeoutSeconds
      )
      {
        const proxy = normalizeGoogleProxySettings(merged)
        merged.googleProxyEnabled = proxy.googleProxyEnabled
        merged.googleProxyUrl = proxy.googleProxyUrl
      }
      if (Array.isArray(parsed.thirdpartyAiGroups)) {
        merged.thirdpartyAiGroups = normalizeThirdpartyAiGroups(parsed.thirdpartyAiGroups)
      } else {
        merged.thirdpartyAiGroups = migrateLegacyThirdpartyAiGroup(parsed)
      }
      return cloneSettings(merged)
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
  return cloneSettings(DEFAULT_SETTINGS)
}

/**
 * 保存设置
 * @param {Object} settings - 设置对象
 * @returns {boolean} 是否保存成功
 */
export const saveSettings = (settings) => {
  try {
    const payload = { ...settings }
    if (Array.isArray(settings && settings.failoverOrder)) {
      payload.failoverOrder = [...settings.failoverOrder]
    }
    if (Array.isArray(settings && settings.thirdpartyAiGroups)) {
      payload.thirdpartyAiGroups = cloneGroups(settings.thirdpartyAiGroups)
    }
    payload.engineResponseTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
      payload.engineResponseTimeoutSeconds
    )
    payload.thirdpartyAiFailoverTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
      payload.thirdpartyAiFailoverTimeoutSeconds
    )
    {
      const proxy = normalizeGoogleProxySettings(payload)
      payload.googleProxyEnabled = proxy.googleProxyEnabled
      payload.googleProxyUrl = proxy.googleProxyUrl
    }
    stripLegacyThirdpartyAiFields(payload)
    // uTools 通常不返回状态；部分存储实现用 false 报告写入失败。
    return window.utools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(payload)) !== false
  } catch {
    // dbStorage 异常可能带入设置值或服务地址，日志只保留固定提示。
    console.error('保存设置失败')
    return false
  }
}

