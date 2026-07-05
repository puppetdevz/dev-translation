/**
 * 翻译输出设置存储工具
 * 使用 uTools dbStorage API 实现持久化
 */

const STORAGE_KEY = 'dev-translation-settings'

// 默认设置
const DEFAULT_SETTINGS = {
  showPhonetic: true,           // 显示音标
  showDefinitions: true,        // 显示释义
  showExamples: true,           // 显示例句
  showVariableNaming: true,     // 显示变量命名样式
  showContextNote: true,        // 显示上下文说明
  detectionStrategy: 'regex',   // 语言检测策略: 'regex' | 'ai'
  translationEngine: 'ai',     // 主翻译引擎（兼容旧版本，实际主引擎由 failoverOrder[0] 决定）
  failoverOrder: ['ai', 'thirdparty-ai', 'google', 'deepl'], // 自动故障转移顺序: 所有引擎的有序列表，首位为主引擎，翻译失败时按此顺序依次重试
  deeplApiKey: '',              // DeepL API Key（Free 版以 :fx 结尾，注册地址 https://www.deepl.com/pro-api）
  deeplMode: 'official',        // DeepL 接入方式: 'official'（官方 API） | 'deeplx'（自部署/公共实例）
  deeplxServerUrl: '',          // DeepLX 服务器地址（如 http://localhost:1188）
  deeplxToken: '',              // DeepLX 访问令牌（可选，自部署无 token 时留空）
  thirdpartyAiUrl: '',              // 第三方 AI API 链接（完整 endpoint，如 https://api.openai.com/v1/chat/completions）
  thirdpartyAiKey: '',              // 第三方 AI API Key（Bearer token）
  thirdpartyAiModel: '',            // 第三方 AI 模型名（如 gpt-4o, deepseek-chat, qwen-plus）
  thirdpartyAiSystemPrompt: '',     // 第三方 AI 翻译时追加的系统提示词（作为 system role，user role 仍放默认指令）
}

/**
 * 加载设置
 * @returns {Object} 设置对象
 */
export const loadSettings = () => {
  try {
    const stored = window.utools.dbStorage.getItem(STORAGE_KEY)
    if (stored) {
      // 合并默认设置，确保新增字段有默认值
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      // 兼容旧版本：若没有 failoverOrder，则用原主引擎 + 其他引擎初始化（主引擎首位）
      if (!merged.failoverOrder || !Array.isArray(merged.failoverOrder) || merged.failoverOrder.length === 0) {
        const main = merged.translationEngine || 'ai'
        merged.failoverOrder = [main, ...['ai', 'thirdparty-ai', 'google', 'deepl'].filter(e => e !== main)]
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

