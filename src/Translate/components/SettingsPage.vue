<script setup>
import { useRouter } from 'vue-router'
import { useSettings } from '../utils/useSettings.js'

const router = useRouter()
const { settings, updateSetting, toggleSetting } = useSettings()

const handleBack = () => {
  router.push({ name: 'translate' })
}

const handleEngineSelect = (engine) => {
  updateSetting('translationEngine', engine)
}

const handleStrategySelect = (strategy) => {
  updateSetting('detectionStrategy', strategy)
}

const aiOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: 'AI 生成美式 IPA 音标' },
  { key: 'showDefinitions', label: '显示释义', desc: 'AI 生成 3-5 条英文释义' },
  { key: 'showExamples', label: '显示例句', desc: 'AI 生成 3-5 条英文例句' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
  { key: 'showContextNote', label: '显示语境说明', desc: 'AI 补充单词使用场景说明' },
]

const googleOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: '词典查询获取音标' },
  { key: 'showDefinitions', label: '显示释义', desc: '词典查询获取释义' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
]
</script>

<template>
  <div class="settings-page">
    <div class="settings-topbar">
      <button class="back-btn" @click="handleBack">
        <span>←</span>
      </button>
      <span class="topbar-title">设置</span>
    </div>

    <div class="settings-body">
      <div class="settings-section">
        <h3 class="section-title">语言检测策略</h3>
        <div class="strategy-list">
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'regex' }"
            @click="handleStrategySelect('regex')"
          >
            <div class="strategy-info">
              <span class="strategy-name">正则算法</span>
              <span class="strategy-desc">基于字符占比快速识别，无需 AI 调用</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'regex'">✓</span>
          </div>
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'ai' }"
            @click="handleStrategySelect('ai')"
          >
            <div class="strategy-info">
              <span class="strategy-name">AI 模型</span>
              <span class="strategy-desc">调用 AI 识别，更准确（有延迟）</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'ai'">✓</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-title">翻译引擎</h3>
        <div class="engine-tabs">
          <button
            class="engine-tab"
            :class="{ active: settings.translationEngine === 'ai' }"
            @click="handleEngineSelect('ai')"
          >
            <span class="engine-icon">🤖</span>
            <span class="engine-label">AI 模型</span>
          </button>
          <button
            class="engine-tab"
            :class="{ active: settings.translationEngine === 'google' }"
            @click="handleEngineSelect('google')"
          >
            <span class="engine-icon">🌐</span>
            <span class="engine-label">Google 翻译</span>
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-title">翻译输出设置</h3>

        <Transition name="output-fade" mode="out-in">
          <div class="outputs-list" :key="settings.translationEngine">
            <div
              v-for="item in settings.translationEngine === 'ai' ? aiOutputs : googleOutputs"
              :key="item.key"
              class="output-item"
            >
              <div class="output-info">
                <span class="output-name">{{ item.label }}</span>
                <span class="output-desc">{{ item.desc }}</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings[item.key] }"
                @click="toggleSetting(item.key)"
              >
                <span class="toggle-slider"></span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
}

.settings-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  flex-shrink: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary, #64748b);
  transition: all 0.2s;
}

.back-btn:hover {
  background: white;
  color: var(--text-primary, #1e293b);
  transform: translateX(-1px);
}

.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
}

.settings-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.strategy-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.strategy-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-item:hover {
  background: rgba(241, 245, 249, 1);
}

.strategy-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.strategy-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strategy-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.strategy-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.strategy-check {
  color: #6366f1;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}

.engine-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.engine-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
}

.engine-tab:hover {
  background: rgba(241, 245, 249, 1);
}

.engine-tab.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
  color: #6366f1;
}

.engine-icon {
  font-size: 16px;
}

.engine-label {
  font-size: 13px;
}

.outputs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border-radius: 10px;
  transition: background 0.2s;
}

.output-item:hover {
  background: rgba(241, 245, 249, 1);
}

.output-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.output-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.output-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.output-fade-enter-active,
.output-fade-leave-active {
  transition: opacity 0.15s ease;
}

.output-fade-enter-from,
.output-fade-leave-to {
  opacity: 0;
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 28px;
  background: rgba(203, 213, 224, 0.8);
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.3s;
  flex-shrink: 0;
}

.toggle-switch.active {
  background: #6366f1;
}

.toggle-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-slider {
  transform: translateX(20px);
}

.settings-body::-webkit-scrollbar {
  width: 6px;
}

.settings-body::-webkit-scrollbar-track {
  background: transparent;
}

.settings-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

@media (prefers-color-scheme: dark) {
  .settings-page {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .settings-topbar {
    background: rgba(30, 41, 59, 0.8);
    border-bottom: 1px solid rgba(51, 65, 85, 0.6);
  }

  .topbar-title {
    color: var(--text-primary, #f1f5f9);
  }

  .back-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
  }

  .back-btn:hover {
    background: #1e293b;
    color: var(--text-primary, #f1f5f9);
  }

  .section-title {
    color: var(--text-secondary, #94a3b8);
  }

  .strategy-item,
  .output-item {
    background: rgba(15, 23, 42, 0.6);
  }

  .strategy-item:hover,
  .output-item:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .strategy-item.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .strategy-name,
  .output-name {
    color: var(--text-primary, #f1f5f9);
  }

  .strategy-desc,
  .output-desc {
    color: var(--text-secondary, #64748b);
  }

  .engine-tab {
    background: rgba(15, 23, 42, 0.6);
    color: var(--text-secondary, #94a3b8);
  }

  .engine-tab:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .engine-tab.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
    color: #a5b4fc;
  }

  .toggle-switch {
    background: rgba(71, 85, 105, 0.8);
  }

  .settings-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }
}

@media (max-width: 768px) {
  .settings-body {
    padding: 16px 12px;
  }
}
</style>
