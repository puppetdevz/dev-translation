<script lang="ts" setup>
import { computed, ref } from 'vue'

const props = defineProps({
  result: {
    type: Object,
    required: true
  },
  originalText: {
    type: String,
    default: ''
  },
  detectedLanguage: {
    type: String,
    default: ''
  },
  settings: {
    type: Object,
    default: () => ({
      showPhonetic: true,
      showDefinitions: true,
      showExamples: true,
      showVariableNaming: true,
      showContextNote: true,
    })
  }
})

// 发音状态
const isSpeaking = ref(false)
const speakingTarget = ref('') // 'original' 或 'translation'

// 发音功能
const speak = (text, lang = 'en-US') => {
  if (!text || isSpeaking.value) return

  // 停止当前播放
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.9

  isSpeaking.value = true

  utterance.onend = () => {
    isSpeaking.value = false
    speakingTarget.value = ''
  }

  utterance.onerror = () => {
    isSpeaking.value = false
    speakingTarget.value = ''
  }

  window.speechSynthesis.speak(utterance)
}

// 获取发音语言
const getSpeakLang = (type) => {
  if (props.detectedLanguage === 'zh') {
    // 中译英：原文是中文，翻译是英文
    return type === 'original' ? 'zh-CN' : 'en-US'
  } else {
    // 英译中：原文是英文，翻译是中文
    return type === 'original' ? 'en-US' : 'zh-CN'
  }
}

// 点击原文发音
const speakOriginal = () => {
  speakingTarget.value = 'original'
  speak(props.originalText, getSpeakLang('original'))
}

// 点击翻译发音
const speakTranslation = () => {
  speakingTarget.value = 'translation'
  speak(props.result.translation, getSpeakLang('translation'))
}

// 高亮关键词
const highlightKeyword = (sentence, keyword) => {
  if (!keyword || !sentence) return sentence

  // 尝试匹配关键词（忽略大小写）
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return sentence.replace(regex, '<mark class="highlight">$1</mark>')
}

// 复制文本
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    const displayText = text.length > 30 ? text.substring(0, 30) + '...' : text
    window.utools.showNotification(`已复制: ${displayText}`)
  } catch (err) {
    console.error('Copy failed:', err)
    window.utools.showNotification('复制失败')
  }
}

// 检查 definitions 是否为新格式（对象数组）
const isDefinitionNewFormat = computed(() => {
  if (!props.result.definitions || props.result.definitions.length === 0) return false
  return typeof props.result.definitions[0] === 'object'
})

// 获取格式化后的 definitions
const formattedDefinitions = computed(() => {
  if (!props.result.definitions) return []

  if (isDefinitionNewFormat.value) {
    return props.result.definitions
  }

  // 旧格式转换为新格式
  return props.result.definitions.map((def, index) => ({
    pos: '',
    meaning: def,
    example: props.result.examples?.[index] || '',
    exampleTranslation: ''
  }))
})

// 获取关键词（用于高亮）
const keyword = computed(() => {
  if (props.detectedLanguage === 'zh') {
    // 中译英：翻译结果是英文，用于例句高亮
    return props.result.translation
  } else {
    // 英译中：原文是英文，用于例句高亮
    return props.originalText
  }
})

// 生成变量命名样式
const variableNames = computed(() => {
  const text = props.result.translation
  if (!text) return []

  const words = text.trim()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.toLowerCase())

  if (words.length === 0) return []

  const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1)

  return [
    { label: 'camelCase', value: words[0] + words.slice(1).map(capitalize).join('') },
    { label: 'PascalCase', value: words.map(capitalize).join('') },
    { label: 'snake_case', value: words.join('_') },
    { label: 'UPPER_CASE', value: words.join('_').toUpperCase() },
    { label: 'kebab-case', value: words.join('-') },
  ]
})
</script>

<template>
  <div class="word-result">
    <!-- 单词头部 -->
    <div class="word-header">
      <div class="word-info">
        <h2 class="word-text">{{ result.translation }}</h2>
        <span v-if="settings.showPhonetic && result.phonetic" class="phonetic">{{ result.phonetic }}</span>
      </div>
      <div class="word-actions">
        <button class="btn-speak" :class="{ active: isSpeaking && speakingTarget === 'translation' }"
          @click="speakTranslation" :disabled="isSpeaking">
          <span class="speak-icon">{{ isSpeaking && speakingTarget === 'translation' ? '🔊' : '🔈' }}</span>
        </button>
        <button class="btn-copy-main" @click="copyText(result.translation)">
          <span class="copy-icon">📋</span>
        </button>
      </div>
    </div>

    <!-- 释义列表 -->
    <div v-if="settings.showDefinitions && formattedDefinitions.length > 0" class="definitions-section">
      <div v-for="(def, index) in formattedDefinitions" :key="index" class="definition-item">
        <div class="definition-header">
          <span v-if="def.pos" class="pos-tag">{{ def.pos }}</span>
          <span class="meaning">{{ def.meaning }}</span>
        </div>
        <div v-if="settings.showExamples && def.example" class="example-row">
          <span class="example-text" v-html="highlightKeyword(def.example, keyword)"></span>
          <span v-if="def.exampleTranslation" class="example-translation">
            {{ def.exampleTranslation }}
          </span>
        </div>
      </div>
    </div>

    <!-- 变量命名样式 -->
    <div v-if="settings.showVariableNaming && variableNames.length > 0" class="variable-naming">
      <div class="variable-header">
        <span class="variable-icon">{ }</span>
        <span class="variable-label">变量命名</span>
      </div>
      <div class="variable-list">
        <div v-for="item in variableNames" :key="item.label" class="variable-item" @click="copyText(item.value)">
          <span class="variable-format">{{ item.label }}</span>
          <code class="variable-value">{{ item.value }}</code>
        </div>
      </div>
    </div>

    <!-- 语境说明 -->
    <div v-if="settings.showContextNote && result.contextNote" class="context-note">
      <div class="context-header">
        <span class="context-icon">💡</span>
        <span class="context-label">语境说明</span>
      </div>
      <p class="context-text">{{ result.contextNote }}</p>
    </div>

  </div>
</template>

<style scoped>
.word-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

/* 单词头部 */
.word-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px;
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.word-info {
  flex: 1;
  min-width: 0;
}

.word-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  margin: 0 0 6px 0;
  line-height: 1.3;
}

.phonetic {
  font-size: 14px;
  font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
  color: #667eea;
  font-weight: 600;
}

.word-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.btn-speak,
.btn-copy-main {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(102, 126, 234, 0.2);
}

.btn-speak:hover,
.btn-copy-main:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.25);
}

.btn-speak.active {
  background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
}

.btn-speak:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.speak-icon,
.copy-icon {
  font-size: 16px;
}

/* 释义列表 */
.definitions-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.definition-item {
  padding: 10px 12px;
  background: white;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.2s ease;
}

.definition-item:hover {
  border-color: rgba(226, 232, 240, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.definition-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.pos-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  white-space: nowrap;
}

.meaning {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.example-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.example-text {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.5;
}

.example-text :deep(.highlight) {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
  color: #667eea;
  font-weight: 600;
  padding: 0 2px;
  border-radius: 2px;
}

.example-translation {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  line-height: 1.4;
}

/* 变量命名样式 */
.variable-naming {
  padding: 10px 12px;
  background: white;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.variable-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.variable-icon {
  font-size: 13px;
  font-weight: 700;
  color: #6366f1;
  font-family: monospace;
}

.variable-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
}

.variable-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.variable-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.variable-item:hover {
  background: rgba(99, 102, 241, 0.06);
}

.variable-format {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-family: monospace;
  width: 80px;
  flex-shrink: 0;
}

.variable-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  font-family: 'SFMono-Regular', Consolas, monospace;
}

/* 语境说明 */
.context-note {

  .context-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .context-icon {
    font-size: 14px;
  }

  .context-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #64748b);
  }

  .context-text {
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    line-height: 1.5;
    margin: 0;
  }
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  .variable-naming {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.6);
  }

  .variable-item:hover {
    background: rgba(99, 102, 241, 0.1);
  }

  .variable-value {
    color: var(--text-primary, #f1f5f9);
  }

  .word-header {
    border-color: rgba(51, 65, 85, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .word-text {
    color: var(--text-primary, #f1f5f9);
  }

  .definition-item {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .definition-item:hover {
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .meaning {
    color: var(--text-primary, #f1f5f9);
  }

  .example-text {
    color: var(--text-secondary, #94a3b8);
  }

  .example-text :deep(.highlight) {
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.3) 0%, rgba(118, 75, 162, 0.3) 100%);
    color: #a5b4fc;
  }

  .example-translation {
    color: var(--text-secondary, #64748b);
  }

  .context-note {
    background: #0f172a;
    border-color: rgba(51, 65, 85, 0.6);
  }

  .context-label {
    color: var(--text-secondary, #94a3b8);
  }

  .context-text {
    color: var(--text-primary, #f1f5f9);
  }
}

/* 响应式布局 */
@media (max-width: 768px) {
  .word-header {
    padding: 12px;
  }

  .word-text {
    font-size: 20px;
  }

  .phonetic {
    font-size: 13px;
  }

  .btn-speak,
  .btn-copy-main {
    width: 32px;
    height: 32px;
  }

  .definition-item {
    padding: 10px 12px;
  }

  .meaning {
    font-size: 13px;
  }

  .example-text {
    font-size: 12px;
  }

}

/* 小窗口优化 */
@media (max-height: 550px) {
  .word-result {
    gap: 8px;
  }

  .word-header {
    padding: 10px 12px;
  }

  .word-text {
    font-size: 18px;
    margin-bottom: 4px;
  }

  .phonetic {
    font-size: 12px;
  }

  .definition-item {
    padding: 8px 10px;
  }

  .meaning {
    font-size: 12px;
  }

  .example-text {
    font-size: 11px;
  }

  .context-note {
    padding: 8px 10px;
  }
}
</style>
