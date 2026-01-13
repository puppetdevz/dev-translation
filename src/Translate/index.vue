<script lang="ts" setup>
import { ref, watch, nextTick } from 'vue'
import InputArea from './components/InputArea.vue'
import ResultDisplay from './components/ResultDisplay.vue'
import KeyboardShortcuts from './components/KeyboardShortcuts.vue'

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

// 语言检测
const detectLanguage = (text) => {
  if (!text || !text.trim()) return ''
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0
  return chineseRatio > 0.3 ? 'zh' : 'en'
}

// 构建中译英 Prompt
const buildChineseToEnglishPrompt = (text) => {
  return `请将以下中文翻译成英文，并以JSON格式返回结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "英文翻译",
  "phonetic": "美式音标(IPA格式)",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}

要求:
1. translation: 准确、地道的英文翻译
2. phonetic: 使用国际音标(IPA)，美式发音，格式如 /ˈhɛloʊ/
3. definitions: 提供3-5个英文释义，解释翻译结果的不同含义
4. examples: 提供3-5个英文例句，展示翻译结果的实际用法
5. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
}

// 构建英译中 Prompt
const buildEnglishToChinesePrompt = (text) => {
  return `请将以下英文翻译成中文，并以JSON格式返回结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "中文翻译",
  "phonetic": "英文原文的美式音标(IPA格式)",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}

要求:
1. translation: 准确、地道的中文翻译
2. phonetic: 原英文的美式音标(IPA格式)，格式如 /ˈhɛloʊ/
3. definitions: 提供3-5个英文释义(保持英文)，解释原文的不同含义
4. examples: 提供3-5个英文例句(保持英文)，展示原文的实际用法
5. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
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

// 清空输入
const handleClear = () => {
  inputText.value = ''
  translationResult.value = null
  error.value = ''
  detectedLanguage.value = ''
}

// 重试
const handleRetry = () => {
  translate()
}

// 监听输入变化，实时检测语言
watch(inputText, (newValue) => {
  if (newValue) {
    detectedLanguage.value = detectLanguage(newValue)
  } else {
    detectedLanguage.value = ''
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
    <div class="translate-header">
      <h1 class="translate-title">
        <span class="title-icon">🌐</span>
        开发者翻译
      </h1>
    </div>

    <div class="translate-content">
      <div class="translate-input-section">
        <InputArea
          v-model="inputText"
          :detectedLanguage="detectedLanguage"
          :isLoading="isLoading"
          @translate="translate"
          @clear="handleClear"
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
  background: linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%);
  color: var(--text-primary, #2c3e50);
  overflow: hidden;
}

.translate-header {
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.translate-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #2c3e50);
  display: flex;
  align-items: center;
  gap: 10px;
  letter-spacing: -0.5px;
}

.title-icon {
  font-size: 28px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.translate-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 24px;
  gap: 16px;
}

.translate-input-section {
  flex-shrink: 0;
}

.translate-result-section {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* 自定义滚动条 */
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
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

@media (prefers-color-scheme: dark) {
  .translate-container {
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
    color: var(--text-primary, #e0e0e0);
  }

  .translate-header {
    background: rgba(45, 45, 45, 0.8);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .translate-title {
    color: var(--text-primary, #e0e0e0);
  }

  .translate-footer {
    background: rgba(45, 45, 45, 0.6);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
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

  .translate-header {
    padding: 12px 16px;
  }

  .translate-title {
    font-size: 20px;
  }

  .title-icon {
    font-size: 24px;
  }

  .translate-footer {
    padding: 10px 16px;
  }
}

/* 小窗口优化 */
@media (max-height: 600px) {
  .translate-header {
    padding: 10px 16px;
  }

  .translate-title {
    font-size: 18px;
  }

  .title-icon {
    font-size: 20px;
  }

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
  .translate-header {
    padding: 8px 12px;
  }

  .translate-title {
    font-size: 16px;
  }

  .title-icon {
    font-size: 18px;
  }

  .translate-content {
    padding: 6px 12px;
    gap: 8px;
  }
}
</style>
