<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useCopyToast } from '../utils/useCopyToast.js'
import { attachDefinitionExamples, hasConfirmedUsPhonetic, selectDirectionDefinitions } from '../utils/engineBridge.js'
import VariableNaming from './VariableNaming.vue'

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
      showPartOfSpeech: true,
      showExamples: true,
      showVariableNaming: true,
      showAiNaming: false,
      showContextNote: true,
    })
  },
  /** 词典补全字段状态：idle | loading | available | unavailable | hidden */
  dictionaryStatus: {
    type: Object,
    default: () => ({ phonetic: 'idle', definitions: 'idle' }),
  },
  /** AI 命名状态与结果（独立于常规命名行） */
  aiNamingStatus: { type: String, default: 'off' },
  aiNamingWords: { type: Array, default: () => [] },
  aiNamingMessage: { type: String, default: '' },
})

const emit = defineEmits(['retry-naming'])

const { toastVisible, toastText, copyWithToast } = useCopyToast()

// 发音状态
const isSpeaking = ref(false)

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
  }

  utterance.onerror = () => {
    isSpeaking.value = false
  }

  window.speechSynthesis.speak(utterance)
}

// 音标点击 -> 朗读对应的英文文本
const speakPhonetic = () => {
  speak(getEnglishSource(), 'en-US')
}

// 将不可信例句拆成文本片段，由 Vue 文本节点转义，绝不拼接外部 HTML。
const highlightKeyword = (sentence, keyword) => {
  const text = String(sentence ?? '')
  const term = String(keyword ?? '')
  if (!term || !text) return [{ text, highlight: false }]

  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.split(regex).map((text, index) => ({ text, highlight: index % 2 === 1 }))
}

// 获取英文源文本（变量命名和例句高亮都需要英文）
const getEnglishSource = () => {
  return props.detectedLanguage === 'zh' ? props.result.translation : props.originalText
}

// 获取关键词（用于高亮）
const keyword = computed(() => getEnglishSource())

// 获取格式化后的 definitions。只展示方向正确的释义，例句最多 2 条。
const formattedDefinitions = computed(() => {
  if (!props.result.definitions) return []
  const lang = props.detectedLanguage === 'zh' ? 'zh' : 'en'
  const selected = selectDirectionDefinitions(props.result.definitions, lang)
  return attachDefinitionExamples(selected, props.result.examples)
})

// 音标只展示来源明确的美式 IPA；形状合格但无法确认口音时不显示。
const phoneticDisplay = computed(() => {
  if (hasConfirmedUsPhonetic(props.result.phonetic, props.result.phoneticRegion)) {
    return { text: String(props.result.phonetic).trim(), placeholder: false }
  }
  const state = props.dictionaryStatus && props.dictionaryStatus.phonetic
  if (state === 'loading') return { text: '音标补全中…', placeholder: true }
  if (state === 'unavailable') return { text: '暂无音标', placeholder: true }
  return null
})

// 释义缺失/加载提示；关闭释义开关时整块（含词性）隐藏，不出现「暂无词性」
const definitionsPlaceholder = computed(() => {
  if (!props.settings.showDefinitions) return ''
  if (formattedDefinitions.value.length) return ''
  const state = props.dictionaryStatus && props.dictionaryStatus.definitions
  if (state === 'loading') return '释义补全中…'
  if (state === 'unavailable') return '暂无释义'
  return ''
})

const handleRetryNaming = () => {
  emit('retry-naming')
}
</script>

<template>
  <div class="word-result">
    <!-- 单词头部 -->
    <div class="word-header">
      <div class="word-info">
        <h2 class="word-text" @click="copyWithToast(result.translation)">{{ result.translation }}</h2>
        <span
          v-if="settings.showPhonetic && phoneticDisplay"
          class="phonetic"
          :class="{ speaking: isSpeaking, placeholder: phoneticDisplay.placeholder }"
          @click="phoneticDisplay.placeholder ? null : speakPhonetic()"
        >{{ phoneticDisplay.text }}</span>
      </div>
    </div>

    <!-- 释义列表 -->
    <div v-if="settings.showDefinitions" class="definitions-section">
      <div v-for="(def, index) in formattedDefinitions" :key="index" class="definition-item">
        <div class="definition-header">
          <span v-if="settings.showPartOfSpeech && def.pos" class="pos-tag">{{ def.pos }}</span>
          <span class="meaning">{{ def.meaning }}</span>
        </div>
        <div v-if="settings.showExamples && def.example" class="example-row">
          <span class="example-text"><template v-for="(part, partIndex) in highlightKeyword(def.example, keyword)" :key="partIndex"><mark v-if="part.highlight" class="highlight">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
          <span v-if="def.exampleTranslation" class="example-translation">
            {{ def.exampleTranslation }}
          </span>
        </div>
      </div>
      <div v-if="definitionsPlaceholder" class="definition-placeholder">{{ definitionsPlaceholder }}</div>
    </div>

    <!-- 变量命名：常规行与 AI 行各自独立 -->
    <VariableNaming
      :englishText="getEnglishSource()"
      :enabled="settings.showVariableNaming"
      :aiEnabled="!!settings.showAiNaming"
      :aiStatus="aiNamingStatus"
      :aiWords="aiNamingWords"
      :aiMessage="aiNamingMessage"
      @retry="handleRetryNaming"
    />

    <!-- 语境说明 -->
    <div v-if="settings.showContextNote && result.contextNote" class="context-note">
      <div class="context-header">
        <span class="context-icon">💡</span>
        <span class="context-label">语境说明</span>
      </div>
      <p class="context-text">{{ result.contextNote }}</p>
    </div>

    <!-- 复制成功提示 -->
    <Transition name="toast">
      <div v-if="toastVisible" class="copy-toast">{{ toastText }}</div>
    </Transition>
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
  cursor: pointer;
  transition: color 0.2s ease;
}

.word-text:hover {
  color: #667eea;
}

.phonetic {
  font-size: 14px;
  font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
  color: #667eea;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s ease, opacity 0.2s ease;
}

.phonetic:hover {
  opacity: 0.7;
}

.phonetic.placeholder {
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
  cursor: default;
}

.phonetic.placeholder:hover {
  opacity: 1;
}

.definition-placeholder {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  border: 1px dashed rgba(148, 163, 184, 0.4);
  border-radius: 10px;
}

.phonetic.speaking {
  color: #764ba2;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-style: wavy;
  text-decoration-color: rgba(118, 75, 162, 0.4);
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

/* 复制成功 Toast */
.copy-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.35);
  white-space: nowrap;
  pointer-events: none;
  z-index: 9999;
}

.toast-enter-active {
  transition: all 0.3s ease;
}

.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
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

  .word-text:hover {
    color: #a5b4fc;
  }

  .phonetic {
    color: #a5b4fc;
  }

  .phonetic:hover {
    opacity: 0.6;
  }

  .phonetic.placeholder {
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
  cursor: default;
}

.phonetic.placeholder:hover {
  opacity: 1;
}

.definition-placeholder {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  border: 1px dashed rgba(148, 163, 184, 0.4);
  border-radius: 10px;
}

.phonetic.speaking {
    color: #c084fc;
    text-decoration-color: rgba(192, 132, 252, 0.4);
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
