<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  detectedLanguage: {
    type: String,
    default: ''
  },
  isLoading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'translate', 'clear'])

const text = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const languageIndicator = computed(() => {
  if (!props.detectedLanguage) return ''
  return props.detectedLanguage === 'zh' ? '中 → 英' : '英 → 中'
})

const charCount = computed(() => {
  return props.modelValue.length
})

const handleTranslate = () => {
  if (text.value && !props.isLoading) {
    emit('translate')
  }
}

const handleClear = () => {
  emit('clear')
}

const handleKeydown = (event) => {
  // Enter 键翻译（不按 Shift）
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleTranslate()
  }
  // Shift + Enter 换行（默认行为）
}
</script>

<template>
  <div class="input-area">
    <div class="input-header">
      <div class="language-badge" v-if="languageIndicator">
        <span class="badge-icon">{{ detectedLanguage === 'zh' ? '🇨🇳' : '🇺🇸' }}</span>
        <span class="badge-text">{{ languageIndicator }}</span>
      </div>
      <span class="char-count" :class="{ 'char-count-warning': charCount > 4500 }">
        字符数: {{ charCount }}/5000
      </span>
    </div>

    <textarea
      v-model="text"
      class="input-textarea"
      placeholder="请输入要翻译的内容..."
      maxlength="5000"
      @keydown="handleKeydown"
    />

    <div class="input-actions">
      <button
        class="btn btn-clear"
        @click="handleClear"
        :disabled="!text"
      >
        <span class="btn-icon">🗑️</span>
        <span class="btn-text">清空</span>
      </button>
      <button
        class="btn btn-translate"
        @click="handleTranslate"
        :disabled="!text || isLoading"
      >
        <span class="btn-icon" v-if="!isLoading">✨</span>
        <span class="btn-spinner" v-else></span>
        <span class="btn-text">{{ isLoading ? '翻译中...' : '翻译' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.input-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
}

.input-area:hover {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
}

.input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.language-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  animation: fadeIn 0.3s ease;
}

.badge-icon {
  font-size: 16px;
}

.badge-text {
  letter-spacing: 0.5px;
}

.char-count {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #8492a6);
  transition: color 0.3s ease;
}

.char-count-warning {
  color: #f56c6c;
  font-weight: 600;
}

.input-textarea {
  width: 100%;
  min-height: 80px;
  max-height: 200px;
  padding: 12px;
  border: 2px solid transparent;
  border-radius: 12px;
  background-color: rgba(248, 250, 252, 0.8);
  color: var(--text-primary, #2c3e50);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  transition: all 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
}

.input-textarea:focus {
  outline: none;
  border-color: #667eea;
  background-color: rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 0 0 1px #667eea, 0 0 0 2px rgba(102, 126, 234, 0.1);
}

.input-textarea::placeholder {
  color: var(--text-secondary, #a0aec0);
}

/* 输入框滚动条样式 */
.input-textarea::-webkit-scrollbar {
  width: 6px;
}

.input-textarea::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 3px;
}

.input-textarea::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.3);
  border-radius: 3px;
  transition: background 0.2s ease;
}

.input-textarea::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.5);
}

.input-textarea:hover {
  overflow-y: auto;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: translate(-50%, -50%);
  transition: width 0.6s, height 0.6s;
}

.btn:active::before {
  width: 300px;
  height: 300px;
}

.btn-icon {
  font-size: 16px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}

.btn-text {
  position: relative;
  z-index: 1;
}

.btn-clear {
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e7eb 100%);
  color: var(--text-primary, #4a5568);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.btn-clear:hover:not(:disabled) {
  background: linear-gradient(135deg, #e4e7eb 0%, #cbd5e0 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.btn-translate {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-translate:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-color-scheme: dark) {
  .input-area {
    background: rgba(45, 45, 45, 0.9);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .input-area:hover {
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }

  .input-textarea {
    background-color: rgba(30, 30, 30, 0.8);
    color: var(--text-primary, #e0e0e0);
  }

  .input-textarea:focus {
    background-color: rgba(40, 40, 40, 0.95);
  }

  /* 深色模式输入框滚动条 */
  .input-textarea::-webkit-scrollbar-thumb {
    background: rgba(102, 126, 234, 0.4);
  }

  .input-textarea::-webkit-scrollbar-thumb:hover {
    background: rgba(102, 126, 234, 0.6);
  }

  .btn-clear {
    background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
    color: var(--text-primary, #e0e0e0);
  }

  .btn-clear:hover:not(:disabled) {
    background: linear-gradient(135deg, #4a4a4a 0%, #3a3a3a 100%);
  }
}

@media (max-width: 768px) {
  .input-area {
    padding: 12px;
    gap: 10px;
  }

  .input-textarea {
    min-height: 70px;
    font-size: 14px;
  }

  /* 移动端输入框滚动条更细 */
  .input-textarea::-webkit-scrollbar {
    width: 4px;
  }

  .btn {
    padding: 8px 16px;
    font-size: 13px;
  }

  .language-badge {
    padding: 4px 10px;
    font-size: 12px;
  }
}

/* 小窗口优化 */
@media (max-height: 600px) {
  .input-area {
    padding: 10px;
    gap: 8px;
  }

  .input-textarea {
    min-height: 60px;
    max-height: 120px;
    padding: 10px;
    font-size: 13px;
  }

  .btn {
    padding: 6px 14px;
    font-size: 12px;
  }

  .language-badge {
    padding: 4px 8px;
    font-size: 11px;
  }

  .input-header {
    margin-bottom: 4px;
  }
}
</style>
