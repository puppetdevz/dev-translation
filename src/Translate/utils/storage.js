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
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
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

/**
 * 重置设置为默认值
 * @returns {Object} 默认设置对象
 */
export const resetSettings = () => {
  const defaultSettings = { ...DEFAULT_SETTINGS }
  saveSettings(defaultSettings)
  return defaultSettings
}

/**
 * 获取默认设置（用于重置按钮显示）
 * @returns {Object} 默认设置对象
 */
export const getDefaultSettings = () => {
  return { ...DEFAULT_SETTINGS }
}
