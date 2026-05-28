<script lang="ts" setup>
import { computed } from 'vue'
import WordResult from './WordResult.vue'
import { copyText } from '../utils/clipboard.js'

const props = defineProps({
  result: {
    type: Object,
    default: null
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  inputType: {
    type: String,
    default: 'word' // 'word' 或 'sentence'
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

const emit = defineEmits(['retry'])

const handleRetry = () => {
  emit('retry')
}
</script>

<template>
  <div class="result-display">
    <!-- 统一容器 - 所有状态共用 -->
    <div class="result-container">
      <!-- 加载状态内容 -->
      <template v-if="isLoading">
        <div class="loading-animation">
          <div class="loading-circle"></div>
          <div class="loading-circle"></div>
          <div class="loading-circle"></div>
        </div>
        <p class="loading-text">正在翻译中...</p>
      </template>

      <!-- 错误状态内容 -->
      <template v-else-if="error">
        <div class="error-icon">⚠️</div>
        <p class="error-message">{{ error }}</p>
        <button class="btn-retry" @click="handleRetry">
          <span class="retry-icon">🔄</span>
          <span>重试</span>
        </button>
      </template>

      <!-- 单词/词组模式 - 词典风格展示 -->
      <template v-else-if="result && inputType === 'word'">
        <WordResult
          :result="result"
          :originalText="originalText"
          :detectedLanguage="detectedLanguage"
          :settings="settings"
        />
      </template>

      <!-- 句子模式 - 简洁展示 -->
      <template v-else-if="result && inputType === 'sentence'">
        <div class="sentence-result">
          <div class="sentence-card">
            <p class="translation-text">{{ result.translation }}</p>
            <button class="btn-copy" @click="copyText(result.translation)">
              <span class="copy-icon">📋</span>
            </button>
          </div>
        </div>
      </template>

      <!-- 空状态内容 - 无内容 -->
    </div>
  </div>
</template>

<style scoped>
.result-display {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 统一容器 - 所有状态共用 */
.result-container {
  width: 100%;
  height: 100%;
  flex: 1;
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

/* 加载状态内容 */
.loading-animation {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.loading-circle {
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.loading-circle:nth-child(1) {
  animation-delay: -0.32s;
}

.loading-circle:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.loading-text {
  font-size: 13px;
  font-weight: 500;
  margin: 0;
  color: var(--text-secondary, #8492a6);
}

/* 错误状态内容 */
.error-icon {
  font-size: 40px;
  margin-bottom: 12px;
  filter: drop-shadow(0 4px 8px rgba(245, 108, 108, 0.3));
}

.error-message {
  color: #f56c6c;
  margin-bottom: 16px;
  font-size: 13px;
  font-weight: 500;
}

.btn-retry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.25);
}

.btn-retry:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(102, 126, 234, 0.3);
}

.retry-icon {
  font-size: 14px;
}

/* 当有结果时，容器需要调整布局 */
.result-container:has(.word-result),
.result-container:has(.sentence-result) {
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

/* 句子模式样式 */
.sentence-result {
  width: 100%;
}

.sentence-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.2s ease;
  animation: fadeInUp 0.3s ease;
}

.sentence-card:hover {
  border-color: rgba(226, 232, 240, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.translation-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  margin: 0;
  line-height: 1.6;
  flex: 1;
  word-break: break-word;
}

.btn-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(102, 126, 234, 0.2);
  flex-shrink: 0;
}

.btn-copy:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.25);
}

.copy-icon {
  font-size: 16px;
}

@media (prefers-color-scheme: dark) {
  /* 统一容器深色模式 */
  .result-container {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  /* 当有结果时，容器背景透明 */
  .result-container:has(.word-result),
  .result-container:has(.sentence-result) {
    background: transparent;
    border: none;
    box-shadow: none;
  }

  .sentence-card {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .sentence-card:hover {
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .translation-text {
    color: var(--text-primary, #f1f5f9);
  }
}

/* 响应式布局 */
@media (max-width: 768px) {
  .sentence-card {
    padding: 16px;
  }

  .translation-text {
    font-size: 16px;
  }
}

/* 小窗口优化 */
@media (max-height: 550px) {
  .result-container {
    padding: 16px;
  }

  .sentence-card {
    padding: 14px;
  }

  .translation-text {
    font-size: 15px;
  }
}

/* 超小窗口优化 */
@media (max-height: 400px) {
  .result-container {
    padding: 12px;
  }

  .sentence-card {
    padding: 12px;
  }

  .translation-text {
    font-size: 14px;
  }
}
</style>
