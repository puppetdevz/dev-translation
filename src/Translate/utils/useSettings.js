import { reactive } from 'vue'
import { loadSettings, saveSettings } from './storage.js'

// 模块级单例，确保所有组件共享同一份设置
let settings = null

/**
 * 使用翻译输出设置
 * @returns {{ settings: Object, updateSetting: Function, toggleSetting: Function }}
 */
export function useSettings() {
  if (!settings) {
    settings = reactive(loadSettings())
  }

  /**
   * 更新指定设置项
   * @param {string} key - 设置项键名
   * @param {*} value - 新值
   */
  const updateSetting = (key, value) => {
    settings[key] = value
    return saveSettings({ ...settings })
  }

  /**
   * 切换布尔型设置项
   * @param {string} key - 设置项键名
   */
  const toggleSetting = (key) => {
    settings[key] = !settings[key]
    saveSettings({ ...settings })
  }

  return { settings, updateSetting, toggleSetting }
}
