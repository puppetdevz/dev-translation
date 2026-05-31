<script lang="ts" setup>
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import InputArea from './components/InputArea.vue'
import ResultDisplay from './components/ResultDisplay.vue'
import {
  buildChineseToEnglishPrompt,
  buildEnglishToChinesePrompt,
  buildPolishPrompt
} from './prompts/index.js'
import { useSettings } from './utils/useSettings.js'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

// 设置状态
const router = useRouter()
const { settings, toggleSetting, updateSetting } = useSettings()

// 核心状态
const inputText = ref('')
const detectedLanguage = ref('')
const isManualOverride = ref(false)
const inputType = ref('word') // 'word' 或 'sentence'
const translationResult = ref(null)
const isLoading = ref(false)
const error = ref('')

// 润色相关状态
const isPolishing = ref(false)
const polishedText = ref('')
const originalText = ref('')

// 语言检测
const detectLanguage = (text) => {
  if (!text || !text.trim()) return ''
  const chineseChars = text.match(/[一-龥]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0
  return chineseRatio > 0.3 ? 'zh' : 'en'
}

// AI 语言检测
const detectLanguageByAI = async (text) => {
  const result = await window.utools.ai({
    messages: [{ role: 'user', content: `只回复 "zh" 或 "en"，检测以下文本的语言：\n${text.slice(0, 300)}` }]
  })
  const content = result.content.trim().toLowerCase()
  return content.includes('zh') ? 'zh' : 'en'
}

// 统一检测入口（AI 策略含 500ms 防抖）
let detectionTimer = null
const runDetection = (text) => {
  if (!text || !text.trim()) return
  if (settings.detectionStrategy === 'ai') {
    clearTimeout(detectionTimer)
    detectionTimer = setTimeout(async () => {
      detectedLanguage.value = await detectLanguageByAI(text)
    }, 500)
  } else {
    detectedLanguage.value = detectLanguage(text)
  }
}

// 手动切换语言方向
const handleLanguageToggle = () => {
  detectedLanguage.value = detectedLanguage.value === 'zh' ? 'en' : 'zh'
  isManualOverride.value = true
}

// 右键重新自动识别
const handleLanguageRedetect = () => {
  isManualOverride.value = false
  runDetection(inputText.value)
}

// 输入类型检测：单词/词组 vs 句子
const detectInputType = (text) => {
  if (!text || !text.trim()) return 'word'

  const trimmed = text.trim()

  // 检测中文
  const chineseChars = trimmed.match(/[一-龥]/g)
  const isChinese = chineseChars && chineseChars.length / trimmed.length > 0.3

  if (isChinese) {
    // 中文：检测是否有标点符号（句子特征）
    const hasSentencePunctuation = /[。！？；，、]/.test(trimmed)
    // 检测字数（中文词组通常较短）
    const charCount = trimmed.length
    // 如果有句子标点或字数超过阈值，认为是句子
    return (hasSentencePunctuation || charCount > 10) ? 'sentence' : 'word'
  } else {
    // 英文：检测单词数量
    const words = trimmed.split(/\s+/).filter(w => w.length > 0)
    // 检测是否有句子标点
    const hasSentencePunctuation = /[.!?;,\n]/.test(trimmed)

    // 如果有句子标点或单词数超过阈值，认为是句子
    return (hasSentencePunctuation || words.length > 5) ? 'sentence' : 'word'
  }
}

// 解析 AI 响应
const parseResult = (aiResponse, type) => {
  try {
    // 尝试直接解析JSON
    const result = JSON.parse(aiResponse)

    // 句子模式只需验证 translation 字段
    if (type === 'sentence') {
      if (!result.translation) {
        throw new Error('Invalid result structure')
      }
      return result
    }

    // 单词/词组模式验证必需字段
    if (!result.translation) {
      throw new Error('Invalid result structure')
    }

    // 兼容旧格式和新格式
    // 新格式: definitions 是对象数组 [{pos, meaning, example, exampleTranslation}]
    // 旧格式: definitions 是字符串数组，examples 是字符串数组
    if (result.definitions && result.definitions.length > 0) {
      if (typeof result.definitions[0] === 'string') {
        // 旧格式，保持原样
        if (!Array.isArray(result.examples)) {
          throw new Error('Invalid result structure')
        }
      }
      // 新格式无需额外验证
    }

    return result
  } catch (parseError) {
    // 尝试提取JSON代码块
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1])
      } catch (e) {
        // 继续尝试其他方法
      }
    }

    // 尝试提取花括号内容
    const braceMatch = aiResponse.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0])
      } catch (e) {
        // 继续尝试其他方法
      }
    }

    throw new Error('无法解析翻译结果，请重试')
  }
}

const translateWithGoogle = async () => {
  const lang = detectedLanguage.value || detectLanguage(inputText.value)
  detectedLanguage.value = lang

  const type = detectInputType(inputText.value)
  inputType.value = type

  if (!window.services || !window.services.googleTranslate) {
    throw new Error('Google 翻译不可用，请切换至 AI 模式')
  }

  const isEnToZh = lang === 'en'

  if (type === 'sentence') {
    const fromLang = isEnToZh ? 'en' : 'zh-CN'
    const toLang = isEnToZh ? 'zh-CN' : 'en'
    const translation = await window.services.googleTranslate(inputText.value.trim(), fromLang, toLang)
    return { translation }
  }

  if (isEnToZh) {
    const [translation, dict] = await Promise.all([
      window.services.googleTranslate(inputText.value.trim(), 'en', 'zh-CN'),
      window.services.lookupWord(inputText.value.trim()),
    ])
    return {
      translation,
      phonetic: dict.phonetic || '',
      definitions: dict.definitions || [],
      examples: dict.examples || [],
    }
  } else {
    const translation = await window.services.googleTranslate(inputText.value.trim(), 'zh-CN', 'en')
    const dict = await window.services.lookupWord(translation)
    return {
      translation,
      phonetic: dict.phonetic || '',
      definitions: dict.definitions || [],
      examples: dict.examples || [],
    }
  }
}

const translate = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要翻译的内容'
    return
  }

  if (inputText.value.length > 5000) {
    error.value = '文本过长，请控制在5000字符以内'
    return
  }

  isLoading.value = true
  error.value = ''
  translationResult.value = null

  try {
    if (settings.translationEngine === 'google') {
      translationResult.value = await translateWithGoogle()
      return
    }

    const lang = detectedLanguage.value || detectLanguage(inputText.value)
    detectedLanguage.value = lang

    const type = detectInputType(inputText.value)
    inputType.value = type

    const prompt = lang === 'zh'
      ? buildChineseToEnglishPrompt(inputText.value, type)
      : buildEnglishToChinesePrompt(inputText.value, type)

    const result = await window.utools.ai({
      messages: [{ role: 'user', content: prompt }]
    })

    translationResult.value = parseResult(result.content, type)
  } catch (err) {
    console.error('Translation error:', err)
    error.value = err.message || '翻译失败，请重试'
  } finally {
    isLoading.value = false
  }
}

// 润色函数
const polish = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要润色的内容'
    return
  }

  if (inputText.value.length > 5000) {
    error.value = '文本过长，请控制在5000字符以内'
    return
  }

  isPolishing.value = true
  error.value = ''

  try {
    const lang = detectLanguage(inputText.value)
    const prompt = buildPolishPrompt(inputText.value, lang)

    const result = await window.utools.ai({
      messages: [{ role: 'user', content: prompt }]
    })

    // 清理可能的 markdown 代码块
    let polished = result.content.trim()
    polished = polished.replace(/^```[\w]*\n/, '').replace(/\n```$/, '')

    originalText.value = inputText.value
    polishedText.value = polished
  } catch (err) {
    console.error('Polish error:', err)
    error.value = err.message || '润色失败，请重试'
  } finally {
    isPolishing.value = false
  }
}

// 采纳润色结果
const handleAcceptPolish = () => {
  inputText.value = polishedText.value
  polishedText.value = ''
  originalText.value = ''
  // 更新语言检测
  detectedLanguage.value = detectLanguage(inputText.value)
}

// 拒绝润色结果
const handleRejectPolish = () => {
  polishedText.value = ''
  originalText.value = ''
}

// 打开设置页面
const openSettings = () => {
  router.push({ name: 'settings' })
}

// 切换变量命名模式
const toggleVariableNaming = () => {
  toggleSetting('showVariableNaming')
}

const toggleTranslationEngine = () => {
  updateSetting('translationEngine',
    settings.translationEngine === 'ai' ? 'google' : 'ai')
}

const engineLabel = computed(() =>
  settings.translationEngine === 'google' ? 'Google 引擎翻译模式' : 'AI 大模型翻译引擎模式'
)

// 打开 GitHub 仓库
const openGitHub = () => {
  window.utools.shellOpenExternal('https://github.com/puppetdevz/dev-translation')
}

// 清空输入
const handleClear = () => {
  inputText.value = ''
  translationResult.value = null
  error.value = ''
  detectedLanguage.value = ''
  inputType.value = 'word'
  polishedText.value = ''
  originalText.value = ''
}

// 重试
const handleRetry = () => {
  translate()
}

// 监听输入变化，实时检测语言并在输入为空时重置输出
watch(inputText, (newValue) => {
  if (newValue && newValue.trim()) {
    if (!isManualOverride.value) {
      runDetection(newValue)
    }
    inputType.value = detectInputType(newValue)
  } else {
    // 输入为空时，重置所有状态
    isManualOverride.value = false
    detectedLanguage.value = ''
    inputType.value = 'word'
    translationResult.value = null
    error.value = ''
    polishedText.value = ''
    originalText.value = ''
  }
})

// 处理文本选择进入
watch(() => props.enterAction, (action) => {
  if (action.type === 'over' && action.payload) {
    inputText.value = action.payload
    nextTick(() => translate())
  }
}, { immediate: true })
</script>

<template>
  <div class="translate-container">
    <div class="translate-content">
      <div class="translate-input-section">
        <InputArea
          v-model="inputText"
          :detectedLanguage="detectedLanguage"
          :isManualOverride="isManualOverride"
          :isLoading="isLoading"
          :isPolishing="isPolishing"
          :polishedText="polishedText"
          @translate="translate"
          @clear="handleClear"
          @polish="polish"
          @acceptPolish="handleAcceptPolish"
          @rejectPolish="handleRejectPolish"
          @languageToggle="handleLanguageToggle"
          @languageRedetect="handleLanguageRedetect"
        />
      </div>

      <div class="translate-result-section">
        <ResultDisplay
          :result="translationResult"
          :isLoading="isLoading"
          :error="error"
          :inputType="inputType"
          :originalText="inputText"
          :detectedLanguage="detectedLanguage"
          :settings="settings"
          @retry="handleRetry"
        />
      </div>
    </div>

    <div class="translate-footer">
      <div class="footer-left">
        <button
          class="engine-toggle-btn"
          :class="{ active: settings.translationEngine === 'google' }"
          @click="toggleTranslationEngine"
          :aria-label="engineLabel"
        >
          <span>{{ settings.translationEngine === 'google' ? 'Google' : 'AI' }}</span>
        </button>
        <button
          class="var-naming-btn"
          :class="{ active: settings.showVariableNaming }"
          @click="toggleVariableNaming"
          aria-label="编程变量模式"
        >
          <span>&lt;/&gt;</span>
        </button>
      </div>
      <div class="footer-center">
        <a class="github-star-link" @click="openGitHub">⭐ 好用就 Star，不好用提 Issue</a>
      </div>
      <button class="settings-btn" @click="openSettings" title="设置">
        <span>⚙️</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.translate-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  position: relative;
}

/* 设置按钮 */
.settings-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.settings-btn:hover {
  background: white;
  transform: translateY(-1px) rotate(45deg);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.translate-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
}

.translate-input-section {
  flex: 0 0 50%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.translate-result-section {
  flex: 0 0 50%;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* 自定义滚动条 - 输出区域 */
.translate-result-section::-webkit-scrollbar {
  width: 8px;
}

.translate-result-section::-webkit-scrollbar-track {
  background: transparent;
}

.translate-result-section::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.translate-result-section::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

.translate-footer {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(226, 232, 240, 0.6);
  display: grid;
  grid-template-columns: auto 1fr 32px;
  align-items: center;
  gap: 8px;
  position: relative;
}

.footer-center {
  display: flex;
  justify-content: center;
  align-items: center;
}

.github-star-link {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
  user-select: none;
}

.github-star-link:hover {
  color: #6366f1;
  transform: translateY(-1px);
}

.var-naming-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.var-naming-btn:hover {
  background: white;
  border-color: rgba(99, 102, 241, 0.4);
  color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.var-naming-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}

.var-naming-btn::after,
.engine-toggle-btn::after {
  content: attr(aria-label);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  transform: translateY(4px);
  z-index: 20;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.92);
  color: white;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
}

.var-naming-btn::before,
.engine-toggle-btn::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 3px);
  left: 12px;
  transform: translateY(4px) rotate(45deg);
  z-index: 19;
  width: 8px;
  height: 8px;
  background: rgba(15, 23, 42, 0.92);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.var-naming-btn:hover::after,
.var-naming-btn:focus-visible::after,
.engine-toggle-btn:hover::after,
.engine-toggle-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.var-naming-btn:hover::before,
.var-naming-btn:focus-visible::before,
.engine-toggle-btn:hover::before,
.engine-toggle-btn:focus-visible::before {
  opacity: 1;
  transform: translateY(0) rotate(45deg);
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.engine-toggle-btn {
  position: relative;
  min-width: 62px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.engine-toggle-btn:hover {
  background: white;
  border-color: rgba(99, 102, 241, 0.4);
  color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.engine-toggle-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}

@media (prefers-color-scheme: dark) {
  .translate-container {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .translate-footer {
    background: rgba(30, 41, 59, 0.8);
    border-top: 1px solid rgba(51, 65, 85, 0.6);
  }

  .settings-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .settings-btn:hover {
    background: #1e293b;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .var-naming-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .var-naming-btn:hover {
    background: #1e293b;
    border-color: rgba(99, 102, 241, 0.5);
    color: #a5b4fc;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .var-naming-btn.active {
    background: #6366f1;
    border-color: #6366f1;
    color: white;
  }

  .engine-toggle-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .engine-toggle-btn:hover {
    background: #1e293b;
    border-color: rgba(99, 102, 241, 0.5);
    color: #a5b4fc;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .engine-toggle-btn.active {
    background: #6366f1;
    border-color: #6366f1;
    color: white;
  }

  .github-star-link:hover {
    color: #a5b4fc;
  }

  .translate-result-section::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .translate-result-section::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

/* 响应式布局 */
@media (max-width: 768px) {
  .translate-content {
    padding: 12px 16px;
    gap: 12px;
  }

  .translate-footer {
    padding: 10px 16px;
  }
}

/* 小窗口优化 - uTools 默认窗口 */
@media (max-height: 550px) {
  .translate-content {
    padding: 10px;
    gap: 10px;
  }

  .translate-footer {
    display: none;
  }
}

/* 超小窗口优化 */
@media (max-height: 400px) {
  .translate-content {
    padding: 6px 12px;
    gap: 8px;
  }
}
</style>
