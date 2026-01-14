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
    window.utools.showNotification('已复制到剪贴板')
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
        </div>
        <div class="naming-styles">
          <div v-for="(value, key) in namingStyles" :key="key" class="naming-item">
            <span class="naming-label">{{ key }}:</span>
            <code class="naming-value" @click="copyText(value)">{{ value }}</code>
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
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  color: var(--text-secondary, #8492a6);
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
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 3px 10px rgba(102, 126, 234, 0.4);
}

.btn-retry:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.5);
}

.retry-icon {
  font-size: 14px;
}

/* 空状态 - 保持空白 */
.empty-state {
  width: 100%;
  height: 100%;
}

/* 响应式网格布局 */
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  width: 100%;
}

.card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transition: all 0.3s ease;
  animation: fadeInUp 0.4s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
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
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #2c3e50);
  letter-spacing: -0.3px;
}

.btn-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.25);
  flex-shrink: 0;
}

.btn-copy:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(102, 126, 234, 0.35);
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
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
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
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #2c3e50);
  margin: 0 0 6px 0;
  line-height: 1.4;
}

.phonetic-text {
  font-size: 14px;
  font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
  color: #667eea;
  margin: 0;
  font-weight: 500;
}

/* 变量命名样式卡片 */
.naming-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
}

.naming-styles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.naming-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 6px;
  transition: all 0.2s ease;
}

.naming-item:hover {
  background: rgba(102, 126, 234, 0.1);
  transform: translateY(-1px);
}

.naming-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #8492a6);
  white-space: nowrap;
}

.naming-value {
  flex: 1;
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  color: #667eea;
  background: rgba(255, 255, 255, 0.5);
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.naming-value:hover {
  background: rgba(102, 126, 234, 0.15);
  color: #764ba2;
}

/* 合并的释义和例句卡片 */
.combined-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
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
  color: var(--text-primary, #2c3e50);
  font-size: 12px;
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
    background: rgba(45, 45, 45, 0.9);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .card:hover {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  }

  .translation-card,
  .naming-card,
  .combined-card {
    background: rgba(102, 126, 234, 0.1);
  }

  .card-header h3 {
    color: var(--text-primary, #e0e0e0);
  }

  .translation-text,
  .section-item {
    color: var(--text-primary, #e0e0e0);
  }

  .card-content {
    color: var(--text-secondary, #a0aec0);
  }

  .naming-item {
    background: rgba(102, 126, 234, 0.1);
  }

  .naming-item:hover {
    background: rgba(102, 126, 234, 0.15);
  }

  .naming-value {
    background: rgba(0, 0, 0, 0.3);
  }

  .naming-value:hover {
    background: rgba(102, 126, 234, 0.2);
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
