/**
 * 翻译输出设置存储工具
 * 使用 uTools dbStorage API 实现持久化
 */

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
  thirdpartyAiUrl: '',              // 第三方 AI API 链接（完整 endpoint，如 https://api.openai.com/v1/chat/completions）
  thirdpartyAiKey: '',              // 第三方 AI API Key（Bearer token）
  thirdpartyAiModel: '',            // 第三方 AI 模型名（如 gpt-4o, deepseek-chat, qwen-plus）
  thirdpartyAiSystemPrompt: '',     // 第三方 AI 翻译时追加的系统提示词（作为 system role，user role 仍放默认指令）
  logLevel: 'error',                // 日志记录等级: 'debug' | 'info' | 'error'（默认仅记录错误，便于排查翻译失败）
  logRetentionDays: 7,              // 日志保留天数: 1/3/7/0(永久)，到期自动清理；始终受最大条数封顶
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
      // 合并默认设置，确保新增字段有默认值
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
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
      return merged
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
  return { ...DEFAULT_SETTINGS }
}

/**
 * 保存设置
 * @param {Object} settings - 设置对象
 * @returns {boolean} 是否保存成功
 */
export const saveSettings = (settings) => {
  try {
    window.utools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch (error) {
    console.error('保存设置失败:', error)
    return false
  }
}

