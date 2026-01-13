<script lang="ts" setup>
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
      <!-- 翻译结果卡片 - 占据整行 -->
      <div class="card translation-card full-width">
        <div class="card-header">
          <div class="header-left">
            <span class="card-icon">📝</span>
            <h3>翻译结果</h3>
          </div>
          <button class="btn-copy" @click="copyText(result.translation)">
            <span class="copy-icon">📋</span>
            <span>复制</span>
          </button>
        </div>
        <div class="card-content">
          <p class="translation-text">{{ result.translation }}</p>
        </div>
      </div>

      <!-- 音标卡片 -->
      <div class="card phonetic-card">
        <div class="card-header">
          <div class="header-left">
            <span class="card-icon">🔊</span>
            <h3>音标</h3>
          </div>
        </div>
        <div class="card-content">
          <p class="phonetic-text">{{ result.phonetic }}</p>
        </div>
      </div>

      <!-- 释义卡片 -->
      <div class="card definition-card">
        <div class="card-header">
          <div class="header-left">
            <span class="card-icon">📖</span>
            <h3>释义</h3>
          </div>
        </div>
        <div class="card-content">
          <ol class="definition-list">
            <li v-for="(def, index) in result.definitions" :key="index">
              {{ def }}
            </li>
          </ol>
        </div>
      </div>

      <!-- 例句卡片 - 占据整行 -->
      <div class="card example-card full-width">
        <div class="card-header">
          <div class="header-left">
            <span class="card-icon">💬</span>
            <h3>例句</h3>
          </div>
        </div>
        <div class="card-content">
          <ul class="example-list">
            <li v-for="(example, index) in result.examples" :key="index">
              <span class="example-bullet">•</span>
              <span class="example-text">{{ example }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">✍️</div>
      <p class="empty-text">输入内容后点击翻译按钮开始翻译</p>
    </div>
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
  padding: 80px 20px;
  color: var(--text-secondary, #8492a6);
}

.loading-animation {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.loading-circle {
  width: 16px;
  height: 16px;
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
  font-size: 15px;
  font-weight: 500;
  margin: 0;
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.error-icon {
  font-size: 64px;
  margin-bottom: 20px;
  filter: drop-shadow(0 4px 8px rgba(245, 108, 108, 0.3));
}

.error-message {
  color: #f56c6c;
  margin-bottom: 24px;
  font-size: 15px;
  font-weight: 500;
}

.btn-retry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-retry:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.retry-icon {
  font-size: 16px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-secondary, #a0aec0);
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
  opacity: 0.6;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
}

.empty-text {
  font-size: 15px;
  margin: 0;
}

/* 响应式网格布局 */
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  width: 100%;
}

.card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  animation: fadeInUp 0.4s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
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
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-icon {
  font-size: 20px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.card-header h3 {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #2c3e50);
  letter-spacing: -0.3px;
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.btn-copy:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.copy-icon {
  font-size: 14px;
}

.card-content {
  color: var(--text-secondary, #4a5568);
  line-height: 1.7;
}

/* 翻译结果卡片 */
.translation-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
}

.translation-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #2c3e50);
  margin: 0;
  line-height: 1.6;
}

/* 音标卡片 */
.phonetic-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
}

.phonetic-text {
  font-size: 18px;
  font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
  color: #667eea;
  margin: 0;
  font-weight: 500;
}

/* 释义卡片 */
.definition-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
}

.definition-list {
  margin: 0;
  padding-left: 24px;
}

.definition-list li {
  margin-bottom: 12px;
  color: var(--text-primary, #2c3e50);
  font-size: 14px;
  line-height: 1.6;
}

.definition-list li:last-child {
  margin-bottom: 0;
}

/* 例句卡片 */
.example-card {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
}

.example-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.example-list li {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--text-primary, #2c3e50);
  font-size: 14px;
  line-height: 1.7;
}

.example-list li:last-child {
  margin-bottom: 0;
}

.example-bullet {
  color: #667eea;
  font-size: 20px;
  font-weight: bold;
  flex-shrink: 0;
}

.example-text {
  flex: 1;
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
  .phonetic-card,
  .definition-card,
  .example-card {
    background: rgba(102, 126, 234, 0.1);
  }

  .card-header h3 {
    color: var(--text-primary, #e0e0e0);
  }

  .translation-text,
  .definition-list li,
  .example-list li {
    color: var(--text-primary, #e0e0e0);
  }

  .card-content {
    color: var(--text-secondary, #a0aec0);
  }
}

/* 响应式布局 */
@media (max-width: 1024px) {
  .result-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .result-grid {
    gap: 16px;
  }

  .card {
    padding: 16px;
  }

  .translation-text {
    font-size: 18px;
  }

  .phonetic-text {
    font-size: 16px;
  }

  .loading-state,
  .error-state,
  .empty-state {
    padding: 60px 20px;
  }

  .empty-icon,
  .error-icon {
    font-size: 48px;
  }
}
</style>
