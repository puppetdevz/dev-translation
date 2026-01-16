<script lang="ts" setup>
import { computed, ref, onMounted } from 'vue'

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
  },
  isPolishing: {
    type: Boolean,
    default: false
  },
  polishedText: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'translate', 'clear', 'polish', 'acceptPolish', 'rejectPolish'])

// 输入框引用
const textareaRef = ref(null)

// 组件挂载后自动聚焦
onMounted(() => {
  if (textareaRef.value && !props.polishedText) {
    textareaRef.value.focus()
  }
})

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

const handlePolish = () => {
  if (text.value && !props.isLoading && !props.isPolishing) {
    emit('polish')
  }
}

const handleAcceptPolish = () => {
  emit('acceptPolish')
}

const handleRejectPolish = () => {
  emit('rejectPolish')
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
    <!-- 润色对比视图 -->
    <div v-if="polishedText" class="polish-comparison">
      <div class="comparison-panel">
        <div class="panel-header">
          <span class="panel-icon">📝</span>
          <span class="panel-title">原文</span>
        </div>
        <div class="panel-content">{{ modelValue }}</div>
      </div>
      <div class="comparison-panel highlight">
        <div class="panel-header">
          <span class="panel-icon">✨</span>
          <span class="panel-title">润色后</span>
        </div>
        <div class="panel-content">{{ polishedText }}</div>
      </div>
    </div>

    <!-- 普通输入框 -->
    <textarea
      v-else
      ref="textareaRef"
      v-model="text"
      class="input-textarea"
      placeholder="请输入要翻译的内容..."
      maxlength="5000"
      @keydown="handleKeydown"
    />

    <!-- 输入框下方的提示信息 -->
    <div class="input-footer" v-if="!polishedText">
      <div class="language-badge" v-if="languageIndicator">
        <span class="badge-icon">{{ detectedLanguage === 'zh' ? '🇨🇳' : '🇺🇸' }}</span>
        <span class="badge-text">{{ languageIndicator }}</span>
      </div>
      <span class="char-count" :class="{ 'char-count-warning': charCount > 4500 }">
        字符数: {{ charCount }}/5000
      </span>
    </div>

    <div class="input-actions">
      <!-- 润色对比模式下的按钮 -->
      <template v-if="polishedText">
        <button
          class="btn btn-reject"
          @click="handleRejectPolish"
        >
          <span class="btn-icon">❌</span>
          <span class="btn-text">拒绝</span>
        </button>
        <button
          class="btn btn-accept"
          @click="handleAcceptPolish"
        >
          <span class="btn-icon">✅</span>
          <span class="btn-text">采纳</span>
        </button>
      </template>

      <!-- 普通模式下的按钮 -->
      <template v-else>
        <button
          class="btn btn-clear"
          @click="handleClear"
          :disabled="!text"
        >
          <span class="btn-icon">🗑️</span>
          <span class="btn-text">清空</span>
        </button>
        <button
          class="btn btn-polish"
          @click="handlePolish"
          :disabled="!text || isLoading || isPolishing"
        >
          <span class="btn-icon" v-if="!isPolishing">✨</span>
          <span class="btn-spinner" v-else></span>
          <span class="btn-text">{{ isPolishing ? '润色中...' : '润色' }}</span>
        </button>
        <button
          class="btn btn-translate"
          @click="handleTranslate"
          :disabled="!text || isLoading"
        >
          <span class="btn-icon" v-if="!isLoading">🌐</span>
          <span class="btn-spinner" v-else></span>
          <span class="btn-text">{{ isLoading ? '翻译中...' : '翻译' }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.input-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.3s ease;
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
  height: 100%;
}

.input-area:hover {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.05);
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.language-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.25);
  animation: fadeIn 0.3s ease;
}

.badge-icon {
  font-size: 12px;
}

.badge-text {
  letter-spacing: 0.3px;
}

.char-count {
  font-size: 11px;
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
  flex: 1;
  min-height: 100px;
  padding: 16px;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  background-color: #f8fafc;
  color: var(--text-primary, #1e293b);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  transition: all 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
}

.input-textarea:focus {
  outline: none;
  border-color: #667eea;
  background-color: white;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-textarea::placeholder {
  color: #94a3b8;
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

/* 润色对比视图 */
.polish-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 120px;
}

.comparison-panel {
  background: rgba(248, 250, 252, 0.8);
  border: 2px solid transparent;
  border-radius: 12px;
  padding: 12px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comparison-panel.highlight {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
  border-color: rgba(102, 126, 234, 0.3);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #8492a6);
}

.panel-icon {
  font-size: 14px;
}

.panel-title {
  letter-spacing: 0.3px;
}

.panel-content {
  flex: 1;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #2c3e50);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  max-height: 150px;
  padding: 4px;
}

/* 对比面板滚动条 */
.panel-content::-webkit-scrollbar {
  width: 4px;
}

.panel-content::-webkit-scrollbar-track {
  background: transparent;
}

.panel-content::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.3);
  border-radius: 2px;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.5);
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  font-size: 13px;
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

.btn-polish {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(240, 147, 251, 0.4);
}

.btn-polish:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(240, 147, 251, 0.5);
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

.btn-accept {
  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(74, 222, 128, 0.4);
}

.btn-accept:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(74, 222, 128, 0.5);
}

.btn-reject {
  background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(248, 113, 113, 0.4);
}

.btn-reject:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(248, 113, 113, 0.5);
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
    background: #1e293b;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .input-area:hover {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .input-textarea {
    background-color: #0f172a;
    color: var(--text-primary, #f1f5f9);
    border-color: #334155;
  }

  .input-textarea:focus {
    background-color: #1e293b;
    border-color: #667eea;
  }

  /* 深色模式输入框滚动条 */
  .input-textarea::-webkit-scrollbar-thumb {
    background: rgba(102, 126, 234, 0.4);
  }

  .input-textarea::-webkit-scrollbar-thumb:hover {
    background: rgba(102, 126, 234, 0.6);
  }

  /* 深色模式对比面板 */
  .comparison-panel {
    background: #0f172a;
    border-color: #334155;
  }

  .comparison-panel.highlight {
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
    border-color: rgba(102, 126, 234, 0.4);
  }

  .panel-content {
    color: var(--text-primary, #f1f5f9);
  }

  .panel-content::-webkit-scrollbar-thumb {
    background: rgba(102, 126, 234, 0.4);
  }

  .panel-content::-webkit-scrollbar-thumb:hover {
    background: rgba(102, 126, 234, 0.6);
  }

  .btn-clear {
    background: linear-gradient(135deg, #334155 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .btn-clear:hover:not(:disabled) {
    background: linear-gradient(135deg, #475569 0%, #334155 100%);
  }
}

@media (max-width: 768px) {
  .input-area {
    padding: 12px;
    gap: 10px;
  }

  /* 移动端润色对比视图 */
  .polish-comparison {
    grid-template-columns: 1fr;
    gap: 10px;
    min-height: 140px;
  }

  .comparison-panel {
    padding: 10px;
  }

  .panel-content {
    max-height: 120px;
    font-size: 13px;
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
