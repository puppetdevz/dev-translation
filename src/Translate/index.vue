<script lang="ts" setup>
import { ref, watch, nextTick } from 'vue'
import InputArea from './components/InputArea.vue'
import ResultDisplay from './components/ResultDisplay.vue'
import KeyboardShortcuts from './components/KeyboardShortcuts.vue'
import {
  buildChineseToEnglishPrompt,
  buildEnglishToChinesePrompt,
  buildPolishPrompt
} from './prompts/index.js'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

// 核心状态
const inputText = ref('')
const detectedLanguage = ref('')
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
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0
  return chineseRatio > 0.3 ? 'zh' : 'en'
}

// 解析 AI 响应
const parseResult = (aiResponse) => {
  try {
    // 尝试直接解析JSON
    const result = JSON.parse(aiResponse)

    // 验证必需字段
    if (!result.translation || !result.phonetic ||
        !Array.isArray(result.definitions) ||
        !Array.isArray(result.examples)) {
      throw new Error('Invalid result structure')
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

// 翻译函数
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
    const lang = detectLanguage(inputText.value)
    detectedLanguage.value = lang

    const prompt = lang === 'zh'
      ? buildChineseToEnglishPrompt(inputText.value)
      : buildEnglishToChinesePrompt(inputText.value)

    const result = await window.utools.ai({
      messages: [{ role: 'user', content: prompt }]
    })

    translationResult.value = parseResult(result.content)
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

// 清空输入
const handleClear = () => {
  inputText.value = ''
  translationResult.value = null
  error.value = ''
  detectedLanguage.value = ''
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
    detectedLanguage.value = detectLanguage(newValue)
  } else {
    // 输入为空时，重置所有状态
    detectedLanguage.value = ''
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
          :isLoading="isLoading"
          :isPolishing="isPolishing"
          :polishedText="polishedText"
          @translate="translate"
          @clear="handleClear"
          @polish="polish"
          @acceptPolish="handleAcceptPolish"
          @rejectPolish="handleRejectPolish"
        />
      </div>

      <div class="translate-result-section">
        <ResultDisplay
          :result="translationResult"
          :isLoading="isLoading"
          :error="error"
          @retry="handleRetry"
        />
      </div>
    </div>

    <div class="translate-footer">
      <KeyboardShortcuts />
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
}

.translate-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px;
  gap: 20px;
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
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(226, 232, 240, 0.6);
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

/* 小窗口优化 */
@media (max-height: 600px) {
  .translate-content {
    padding: 8px 16px;
    gap: 10px;
  }

  .translate-footer {
    padding: 8px 16px;
  }

  /* 隐藏快捷键提示以节省空间 */
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
