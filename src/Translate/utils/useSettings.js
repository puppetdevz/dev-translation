import { ref, watch } from 'vue'

const STORAGE_KEY = 'dev-translation-settings'

const DEFAULT_SETTINGS = {
  showPhonetic: true,
  showDefinitions: true,
  showExamples: true,
  showVariableNaming: true,
  showContextNote: true,
  detectionStrategy: 'regex',
  translationEngine: 'ai',
}

// Module-level singleton so settings survive route navigation
const settings = ref({ ...DEFAULT_SETTINGS })

let initialized = false

const loadFromStorage = () => {
  try {
    const stored = window.utools?.dbStorage?.getItem(STORAGE_KEY)
    if (stored) {
      settings.value = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

const saveToStorage = (value) => {
  try {
    window.utools?.dbStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

export function useSettings() {
  if (!initialized) {
    loadFromStorage()
    initialized = true
  }

  // Auto-persist on any change
  watch(settings, (newValue) => {
    saveToStorage(newValue)
  }, { deep: true })

  const updateSetting = (key, value) => {
    settings.value = { ...settings.value, [key]: value }
  }

  const toggleSetting = (key) => {
    settings.value = { ...settings.value, [key]: !settings.value[key] }
  }

  return { settings, updateSetting, toggleSetting }
}
