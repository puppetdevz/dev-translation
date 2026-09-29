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
  isManualOverride: {
    type: Boolean,
    default: false
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
  },
  usedEngineLabel: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'translate', 'clear', 'polish', 'acceptPolish', 'rejectPolish', 'languageToggle', 'languageRedetect'])

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

const isDetectingPlaceholder = computed(() => !props.detectedLanguage)

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

    <!-- 普通输入框（含浮动底栏：语言徽章 + 字符数） -->
    <div v-else class="input-field-wrapper">
      <textarea
        ref="textareaRef"
        v-model="text"
        class="input-textarea"
        placeholder="请输入要翻译的内容..."
        @keydown="handleKeydown"
      />
      <div class="input-footer">
        <div class="language-badge"
          :class="{ 'manual-override': isManualOverride, 'language-badge-placeholder': isDetectingPlaceholder }"
          @click="emit('languageToggle')"
          @contextmenu.prevent="emit('languageRedetect')"
          :title="isDetectingPlaceholder ? '左键: 设置为中文翻译 | 输入文字后将自动识别' : (isManualOverride ? '已手动设置\n左键: 切换方向 | 右键: 重新自动识别' : '左键: 切换方向 | 右键: 重新自动识别')"
        >
          <span class="badge-icon">{{ isDetectingPlaceholder ? '🌐' : (detectedLanguage === 'zh' ? '🇨🇳' : '🇺🇸') }}</span>
          <span class="badge-text">{{ isDetectingPlaceholder ? '自动识别' : languageIndicator }}</span>
          <span v-if="!isDetectingPlaceholder && isManualOverride" class="badge-manual">🔒</span>
        </div>
        <span class="char-count" :class="{ 'char-count-warning': charCount > 5000 }">
          字符数: {{ charCount }}
        </span>
      </div>
    </div>

    <!-- 操作行：左侧引擎徽章 + 右侧按钮 -->
    <div class="input-actions">
      <!-- 左侧：翻译引擎标识徽章（与按钮同行、同高） -->
      <div v-if="usedEngineLabel" class="used-engine-badge" :title="`本次由 ${usedEngineLabel} 翻译`">
        <span class="used-engine-badge-dot"></span>
        <span class="used-engine-badge-text">由 {{ usedEngineLabel }} 翻译</span>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="input-actions-btns">
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
  </div>
</template>

<style scoped>
.input-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  max-width: 100%;
  height: 100%;
}

.input-field-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.input-footer {
  position: absolute;
  bottom: 8px;
  left: 12px;
  right: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  background: linear-gradient(to top, var(--input-footer-bg, #fafbfc) 65%, transparent);
  padding: 8px 0 2px 0;
  z-index: 1;
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
  box-shadow: 0 1px 3px rgba(102, 126, 234, 0.2);
  animation: fadeIn 0.3s ease;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
  transition: opacity 0.2s, transform 0.2s;
}

.language-badge:hover {
  opacity: 0.85;
  transform: scale(1.02);
}

.language-badge.manual-override {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  box-shadow: 0 1px 3px rgba(245, 158, 11, 0.3);
}

.language-badge-placeholder {
  background: #f1f5f9;
  color: #94a3b8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  font-weight: 500;
  animation: none;
}

.language-badge-placeholder:hover {
  background: #e2e8f0;
  opacity: 1;
}

.badge-manual {
  font-size: 10px;
  opacity: 0.9;
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
  min-height: 70px;
  padding: 12px 12px 42px 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  background-color: #fafbfc;
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
  border-color: rgba(102, 126, 234, 0.5);
  background-color: white;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.08);
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
  background: #fafbfc;
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  padding: 12px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comparison-panel.highlight {
  background: rgba(102, 126, 234, 0.03);
  border-color: rgba(102, 126, 234, 0.4);
  box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.1);
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
  align-items: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.input-actions-btns {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

/* 翻译引擎标识徽章（与操作按钮同行、同高） */
.used-engine-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #6366f1;
  line-height: 1.2;
  flex-shrink: 0;
  white-space: nowrap;
  animation: used-engine-fade-in 0.3s ease;
}

.used-engine-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366f1;
  flex-shrink: 0;
}

.used-engine-badge-text {
  white-space: nowrap;
}

@keyframes used-engine-fade-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
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
  font-size: 13px;
  transition: transform 0.2s ease;
}

.btn-text {
  position: relative;
  z-index: 1;
}

.btn:hover:not(:disabled) .btn-icon {
  transform: scale(1.15);
}

.btn-clear {
  background: #f1f5f9;
  color: #475569;
  border-color: rgba(226, 232, 240, 0.8);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.btn-clear:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: rgba(203, 213, 225, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.07);
}

.btn-polish {
  background: #ec4899;
  color: white;
  box-shadow: 0 1px 3px rgba(236, 72, 153, 0.25);
}

.btn-polish:hover:not(:disabled) {
  background: #db2777;
  transform: translateY(-1.5px);
  box-shadow: 0 4px 8px rgba(236, 72, 153, 0.35);
}

.btn-translate {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
}

.btn-translate:hover:not(:disabled) {
  background: linear-gradient(135deg, #5a6fe0 0%, #6a4196 100%);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 10px rgba(102, 126, 234, 0.4);
}

.btn-accept {
  background: #10b981;
  color: white;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.25);
}

.btn-accept:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-1.5px);
  box-shadow: 0 4px 8px rgba(16, 185, 129, 0.35);
}

.btn-reject {
  background: #ef4444;
  color: white;
  box-shadow: 0 1px 3px rgba(239, 68, 68, 0.25);
}

.btn-reject:hover:not(:disabled) {
  background: #dc2626;
  transform: translateY(-1.5px);
  box-shadow: 0 4px 8px rgba(239, 68, 68, 0.35);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn-spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(255, 255, 255, 0.25);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
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
  .input-textarea {
    background-color: #0f172a;
    color: var(--text-primary, #f1f5f9);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .input-textarea:focus {
    background-color: #1e293b;
    border-color: rgba(102, 126, 234, 0.6);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.12);
  }

  .input-footer {
    --input-footer-bg: #0f172a;
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
    border-color: rgba(51, 65, 85, 0.6);
  }

  .comparison-panel.highlight {
    background: rgba(102, 126, 234, 0.06);
    border-color: rgba(102, 126, 234, 0.5);
    box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.15);
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
    background: #1e293b;
    color: #e2e8f0;
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .btn-clear:hover:not(:disabled) {
    background: #334155;
    border-color: rgba(71, 85, 105, 0.9);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }

  .btn-polish {
    box-shadow: 0 1px 3px rgba(236, 72, 153, 0.2);
  }

  .btn-polish:hover:not(:disabled) {
    box-shadow: 0 4px 8px rgba(236, 72, 153, 0.3);
  }

  .btn-translate {
    box-shadow: 0 2px 4px rgba(102, 126, 234, 0.25);
  }

  .btn-translate:hover:not(:disabled) {
    box-shadow: 0 4px 10px rgba(102, 126, 234, 0.35);
  }

  .btn-accept {
    box-shadow: 0 1px 3px rgba(16, 185, 129, 0.2);
  }

  .btn-accept:hover:not(:disabled) {
    box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
  }

  .btn-reject {
    box-shadow: 0 1px 3px rgba(239, 68, 68, 0.2);
  }

  .btn-reject:hover:not(:disabled) {
    box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
  }

  .btn-spinner {
    border-color: rgba(255, 255, 255, 0.2);
    border-top-color: white;
  }

  .used-engine-badge {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.3);
    color: #a5b4fc;
  }

  .used-engine-badge-dot {
    background: #a5b4fc;
  }

  .language-badge-placeholder {
    background: #334155;
    color: #94a3b8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .language-badge-placeholder:hover {
    background: #475569;
  }
}

@media (max-width: 768px) {
  .input-area {
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
    padding: 7px 14px;
    font-size: 12px;
  }

  .language-badge {
    padding: 4px 10px;
    font-size: 12px;
  }
}

/* 小窗口优化 */
@media (max-height: 550px) {
  .input-area {
    gap: 8px;
  }

  .input-textarea {
    min-height: 60px;
    max-height: 120px;
    padding: 10px;
    font-size: 13px;
  }

  .btn {
    padding: 6px 12px;
    font-size: 11px;
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
