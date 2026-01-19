<script lang="ts" setup>
import { computed } from 'vue'

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
  }
})

const emit = defineEmits(['retry'])

// 计算单词数量
const wordCount = computed(() => {
  if (!props.result || !props.result.translation) return 0

  const text = props.result.translation.trim()
  // 检测是否为中文
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0

  if (chineseRatio > 0.3) {
    // 中文：字符数
    return text.length
  } else {
    // 英文：单词数
    return text.split(/\s+/).filter(word => word.length > 0).length
  }
})

// 是否显示音标（单词数 <= 3）
const shouldShowPhonetic = computed(() => {
  return wordCount.value > 0 && wordCount.value <= 3
})

// 是否显示变量命名样式（单词数 <= 5）
const shouldShowNamingStyles = computed(() => {
  return wordCount.value > 0 && wordCount.value <= 5
})

// 生成变量命名样式
const namingStyles = computed(() => {
  if (!props.result || !shouldShowNamingStyles.value) return null

  const text = props.result.translation.trim()

  // 将文本转换为单词数组
  let words = []
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0

  if (chineseRatio > 0.3) {
    // 中文：无法生成命名样式
    return null
  } else {
    // 英文：分割单词
    words = text.split(/\s+/).filter(word => word.length > 0)
  }

  if (words.length === 0) return null

  // 生成各种命名样式
  return {
    PascalCase: words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(''),
    camelCase: words.map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(''),
    snake_case: words.map(w => w.toLowerCase()).join('_'),
    UPPER_CASE: words.map(w => w.toUpperCase()).join('_'),
    'kebab-case': words.map(w => w.toLowerCase()).join('-')
  }
})

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    // 显示复制的内容，如果太长则截断
    const displayText = text.length > 30 ? text.substring(0, 30) + '...' : text
    window.utools.showNotification(`已复制: ${displayText}`)
  } catch (err) {
    console.error('Copy failed:', err)
    window.utools.showNotification('复制失败')
  }
}

const handleRetry = () => {
  emit('retry')
}
</script>

<template>
  <div class="result-display">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <div class="loading-animation">
        <div class="loading-circle"></div>
        <div class="loading-circle"></div>
        <div class="loading-circle"></div>
      </div>
      <p class="loading-text">正在翻译中...</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <div class="error-icon">⚠️</div>
      <p class="error-message">{{ error }}</p>
      <button class="btn-retry" @click="handleRetry">
        <span class="retry-icon">🔄</span>
        <span>重试</span>
      </button>
    </div>

    <!-- 结果展示 - 使用响应式网格布局 -->
    <div v-else-if="result" class="result-grid">
      <!-- 翻译结果卡片 - 包含翻译和音标（条件显示） -->
      <div class="card translation-card full-width">
        <div class="translation-main">
          <div class="translation-content">
            <p class="translation-text">{{ result.translation }}</p>
            <p v-if="shouldShowPhonetic" class="phonetic-text">{{ result.phonetic }}</p>
          </div>
          <button class="btn-copy" @click="copyText(result.translation)">
            <span class="copy-icon">📋</span>
          </button>
        </div>
      </div>

      <!-- 变量命名样式卡片 - 仅在单词数 <= 5 时显示 -->
      <div v-if="namingStyles" class="card naming-card full-width">
        <div class="card-header compact">
          <span class="card-icon">💻</span>
          <h3>变量命名</h3>
          <span class="hint-text">点击复制</span>
        </div>
        <div class="naming-styles">
          <div v-for="(value, key) in namingStyles" :key="key" class="naming-item" @click="copyText(value)">
            <span class="naming-label">{{ key }}:</span>
            <code class="naming-value">{{ value }}</code>
            <span class="copy-hint">📋</span>
          </div>
        </div>
      </div>

      <!-- 释义和例句合并卡片 -->
      <div class="card combined-card full-width">
        <div class="card-header compact">
          <span class="card-icon">📚</span>
          <h3>释义与例句</h3>
        </div>
        <div class="card-content">
          <!-- 释义部分 -->
          <div class="section-group">
            <div class="section-items">
              <span v-for="(def, index) in result.definitions.slice(0, 3)" :key="'def-' + index" class="section-item">
                {{ def }}<span v-if="index < Math.min(result.definitions.length, 3) - 1" class="separator">•</span>
              </span>
            </div>
          </div>

          <!-- 例句部分 -->
          <div class="section-group">
            <div class="section-items">
              <span v-for="(example, index) in result.examples.slice(0, 2)" :key="'ex-' + index" class="section-item">
                {{ example }}<span v-if="index < Math.min(result.examples.length, 2) - 1" class="separator">•</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 - 保持空白 -->
    <div v-else class="empty-state"></div>
  </div>
</template>

<style scoped>
.result-display {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  color: var(--text-secondary, #8492a6);
  flex: 1;
}

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
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  text-align: center;
  flex: 1;
}

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

/* 空状态 - 保持空白但带阴影效果 */
.empty-state {
  width: 100%;
  height: 100%;
  flex: 1;
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.5);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: all 0.3s ease;
}

/* 响应式网格布局 */
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  width: 100%;
  align-content: start;
}

.card {
  background: white;
  border-radius: 10px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.2s ease;
  animation: fadeInUp 0.3s ease;
}

.card:hover {
  transform: translateY(-1px);
  border-color: rgba(226, 232, 240, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.full-width {
  grid-column: 1 / -1;
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

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.card-header.compact {
  gap: 6px;
  margin-bottom: 8px;
}

.hint-text {
  font-size: 11px;
  color: var(--text-secondary, #8492a6);
  font-weight: 500;
  margin-left: auto;
  opacity: 0.7;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-icon {
  font-size: 14px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.card-header h3 {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #1e293b);
  letter-spacing: -0.01em;
}

.btn-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 14px;
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
  font-size: 14px;
}

.card-content {
  color: var(--text-secondary, #4a5568);
  line-height: 1.5;
}

/* 翻译结果卡片 - 新布局 */
.translation-card {
  background: #fafbfc;
  border-color: rgba(226, 232, 240, 0.8);
}

.translation-card:hover {
  border-color: rgba(226, 232, 240, 1);
}

.translation-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.translation-content {
  flex: 1;
  min-width: 0;
}

.translation-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  margin: 0 0 8px 0;
  line-height: 1.4;
  letter-spacing: -0.02em;
}

.phonetic-text {
  font-size: 14px;
  font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
  color: #667eea;
  margin: 0;
  font-weight: 600;
}

/* 变量命名样式卡片 */
.naming-card {
  background: #fafbfc;
  border-color: rgba(226, 232, 240, 0.8);
}

.naming-card:hover {
  border-color: rgba(226, 232, 240, 1);
}

.naming-styles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.naming-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
  position: relative;
}

.naming-item:hover {
  background: #fafbfc;
  border-color: rgba(102, 126, 234, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 1px 3px rgba(102, 126, 234, 0.08);
}

.naming-item:active {
  transform: translateY(0);
}

.naming-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #8492a6);
  white-space: nowrap;
}

.naming-value {
  flex: 1;
  font-size: 13px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  color: #667eea;
  background: #f8fafc;
  padding: 4px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  font-weight: 600;
}

.copy-hint {
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.naming-item:hover .copy-hint {
  opacity: 1;
}

.naming-item:hover .naming-value {
  color: #764ba2;
}

/* 合并的释义和例句卡片 */
.combined-card {
  background: #fafbfc;
  border-color: rgba(226, 232, 240, 0.8);
}

.combined-card:hover {
  border-color: rgba(226, 232, 240, 1);
}

.section-group {
  margin-bottom: 10px;
}

.section-group:last-child {
  margin-bottom: 0;
}

.section-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.section-item {
  color: var(--text-primary, #1e293b);
  font-size: 13px;
  line-height: 1.6;
  display: inline;
}

.separator {
  color: #667eea;
  font-weight: bold;
  margin: 0 4px;
}

@media (prefers-color-scheme: dark) {
  .card {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .card:hover {
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .translation-card,
  .naming-card,
  .combined-card {
    background: #0f172a;
    border-color: rgba(51, 65, 85, 0.8);
  }

  .translation-card:hover,
  .naming-card:hover,
  .combined-card:hover {
    border-color: rgba(51, 65, 85, 1);
  }

  .card-header h3 {
    color: var(--text-primary, #f1f5f9);
  }

  .hint-text {
    color: var(--text-secondary, #94a3b8);
  }

  .translation-text,
  .section-item {
    color: var(--text-primary, #f1f5f9);
  }

  .card-content {
    color: var(--text-secondary, #cbd5e1);
  }

  .naming-item {
    background: #0f172a;
    border-color: rgba(51, 65, 85, 0.6);
  }

  .naming-item:hover {
    background: #1e293b;
    border-color: rgba(102, 126, 234, 0.6);
  }

  .naming-value {
    background: #0f172a;
  }

  .naming-item:hover .naming-value {
    background: #1e293b;
  }

  .empty-state {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.5);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
}

/* 响应式布局 */
@media (max-width: 1024px) {
  .result-grid {
    grid-template-columns: 1fr;
  }

  .naming-styles {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .result-grid {
    gap: 8px;
  }

  .card {
    padding: 10px;
  }

  .translation-text {
    font-size: 16px;
  }

  .phonetic-text {
    font-size: 13px;
  }

  .card-header h3 {
    font-size: 12px;
  }

  .card-icon {
    font-size: 13px;
  }

  .section-item {
    font-size: 11px;
  }

  .naming-styles {
    grid-template-columns: 1fr;
  }

  .naming-label {
    font-size: 10px;
  }

  .naming-value {
    font-size: 11px;
  }
}

/* 小窗口优化 */
@media (max-height: 600px) {
  .result-grid {
    gap: 8px;
  }

  .card {
    padding: 8px 10px;
    border-radius: 8px;
  }

  .card-header {
    margin-bottom: 6px;
  }

  .card-header.compact {
    margin-bottom: 6px;
  }

  .translation-text {
    font-size: 16px;
    margin-bottom: 4px;
  }

  .phonetic-text {
    font-size: 12px;
  }

  .section-item {
    font-size: 11px;
  }

  .section-group {
    margin-bottom: 8px;
  }

  .naming-item {
    padding: 4px 8px;
  }
}

/* 超小窗口优化 */
@media (max-height: 400px) {
  .result-grid {
    gap: 6px;
  }

  .card {
    padding: 6px 8px;
  }

  .card-header {
    margin-bottom: 4px;
  }

  .translation-text {
    font-size: 15px;
    margin-bottom: 3px;
  }

  .phonetic-text {
    font-size: 11px;
  }

  .section-item {
    font-size: 10px;
  }

  .section-group {
    margin-bottom: 6px;
  }
}
</style>
