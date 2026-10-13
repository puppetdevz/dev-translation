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
import {
  KNOWN_ENGINES,
  defaultEngineEnabled,
  normalizeEngineEnabled,
  cloneEngineEnabled,
} from './engineAvailability.js'

const STORAGE_KEY = 'dev-translation-settings'

// 引擎白名单由 engineAvailability 统一维护，这里保持旧导出路径兼容。
export { KNOWN_ENGINES }

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
  next.engineEnabled = cloneEngineEnabled(settings.engineEnabled)
  next.thirdpartyAiGroups = cloneGroups(settings.thirdpartyAiGroups || [])
  stripLegacyThirdpartyAiFields(next)
  return next
}

// 默认设置
export const DEFAULT_SETTINGS = {
  showPhonetic: true,           // 显示音标
  showDefinitions: true,        // 显示释义
  showPartOfSpeech: true,       // 显示词性（新增；关闭时仅隐藏 n./v./adj. 等标签，释义含义不变）
  showExamples: true,           // 显示例句
  showVariableNaming: true,     // 显示变量命名样式（只控制常规命名行）
  showAiNaming: false,          // AI 命名（新增；默认关闭，独立于常规命名，依赖已有 AI 来源并会额外联网消耗额度）
  showContextNote: true,        // 显示上下文说明
  detectionStrategy: 'regex',   // 语言检测策略: 'regex' | 'ai'
  translationEngine: 'ai',     // 主翻译引擎（仅作旧配置迁移参考；实际有效主引擎 = failoverOrder 中首个 engineEnabled 为 true 的项）
  failoverOrder: ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun'], // 自动故障转移顺序: 所有引擎的有序列表，首位为主引擎，翻译失败时按此顺序依次重试。deepl=官方 API，deeplx=自部署/公共实例；新增官方引擎追加在旧五引擎之后
  engineEnabled: defaultEngineEnabled(), // 八类引擎持久化总开关映射（{engine: boolean}）；显式 false 保留、缺键/非法值按 true，全 false 合法且不视为缺失
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
  baiduAppId: '',                   // 百度翻译开放平台 APP ID
  baiduSecret: '',                  // 百度翻译密钥
  aliyunAccessKeyId: '',            // 阿里云 AccessKey ID（需 alimt:TranslateGeneral）
  aliyunAccessKeySecret: '',        // 阿里云 AccessKey Secret
  caiyunToken: '',                  // 彩云开放平台 API Token
}

/** 布尔型显示设置：仅接受真正的布尔值，其他类型回退默认值。 */
export const BOOLEAN_SETTING_DEFAULTS = {
  showPhonetic: DEFAULT_SETTINGS.showPhonetic,
  showDefinitions: DEFAULT_SETTINGS.showDefinitions,
  showPartOfSpeech: DEFAULT_SETTINGS.showPartOfSpeech,
  showExamples: DEFAULT_SETTINGS.showExamples,
  showVariableNaming: DEFAULT_SETTINGS.showVariableNaming,
  showAiNaming: DEFAULT_SETTINGS.showAiNaming,
  showContextNote: DEFAULT_SETTINGS.showContextNote,
  googleProxyEnabled: DEFAULT_SETTINGS.googleProxyEnabled,
}

/**
 * 旧配置里缺字段时用默认值（词性默认开启、AI 命名默认关闭），
 * 已保存的 false 必须保留，不得重置。
 */
export function normalizeBooleanSettings(settings) {
  for (const [key, fallback] of Object.entries(BOOLEAN_SETTING_DEFAULTS)) {
    const value = settings[key]
    settings[key] = typeof value === 'boolean' ? value : fallback
  }
  return settings
}


// 升级时仅把缺失的新引擎按该顺序补到末尾，不打乱用户已有相对顺序
export const APPENDED_ENGINES = ['baidu', 'aliyun', 'caiyun']

function dedupeKnownEngines(order) {
  const seen = new Set()
  const result = []
  if (!Array.isArray(order)) return result
  for (const engine of order) {
    if (KNOWN_ENGINES.includes(engine) && !seen.has(engine)) {
      seen.add(engine)
      result.push(engine)
    }
  }
  return result
}

function appendMissingEngines(order, extras) {
  const next = dedupeKnownEngines(order)
  const seen = new Set(next)
  for (const engine of extras || []) {
    if (KNOWN_ENGINES.includes(engine) && !seen.has(engine)) {
      seen.add(engine)
      next.push(engine)
    }
  }
  return next
}

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
      // 白名单过滤：剔除未知引擎标识（防止旧版残留或外部手动写入的未知值导致 SettingsPage 渲染白屏）
      merged.failoverOrder = merged.failoverOrder.filter(e => KNOWN_ENGINES.includes(e))
      // 非空但全为未知标识时须回退默认，不可只剩迁移时补入的引擎。
      if (merged.failoverOrder.length === 0) merged.failoverOrder = [...DEFAULT_SETTINGS.failoverOrder]
      // 兼容旧 failoverOrder 无 thirdparty-ai：在 ai 之后插入
      if (!merged.failoverOrder.includes('thirdparty-ai')) {
        const aiIdx = merged.failoverOrder.indexOf('ai')
        if (aiIdx >= 0) {
          merged.failoverOrder.splice(aiIdx + 1, 0, 'thirdparty-ai')
        } else {
          // 没有 ai 时仍保留原首位（用户手动选定的主引擎）。
          merged.failoverOrder.push('thirdparty-ai')
        }
      }
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
            // DeepLX 为首位时仍应是主引擎。
            merged.failoverOrder.splice(deeplxIdx === 0 ? 1 : deeplxIdx, 0, 'deepl')
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
      // 升级补全：保留原主引擎与相对顺序，仅把缺失的百度/阿里/彩云按固定顺序追加末尾；去重保持幂等
      merged.failoverOrder = appendMissingEngines(merged.failoverOrder, APPENDED_ENGINES)
      // 引擎启停映射：逐项独立规范化，显式 false 保留、缺键/非法值按 true，全 false 合法（不得当成缺失恢复默认）
      merged.engineEnabled = normalizeEngineEnabled(merged.engineEnabled)
      merged.engineResponseTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
        merged.engineResponseTimeoutSeconds
      )
      merged.thirdpartyAiFailoverTimeoutSeconds = normalizeEngineResponseTimeoutSeconds(
        merged.thirdpartyAiFailoverTimeoutSeconds
      )
      // 显示类布尔设置：旧配置缺字段时补默认值（词性 true、AI 命名 false），已有 false 原样保留
      normalizeBooleanSettings(merged)
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
  } catch {
    // dbStorage 异常或不合法数据可能包含本机凭据，只输出固定提示。
    console.error('加载设置失败')
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
      payload.failoverOrder = dedupeKnownEngines(settings.failoverOrder)
    }
    if (Array.isArray(settings && settings.thirdpartyAiGroups)) {
      payload.thirdpartyAiGroups = cloneGroups(settings.thirdpartyAiGroups)
    }
    payload.engineEnabled = normalizeEngineEnabled(payload.engineEnabled)
    normalizeBooleanSettings(payload)
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

