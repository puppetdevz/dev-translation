<script lang="ts" setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:visible', 'save'])

// 本地设置副本
const localSettings = ref({ ...props.settings })

// 监听 props.settings 变化，同步到本地副本
watch(() => props.settings, (newSettings) => {
  localSettings.value = { ...newSettings }
}, { deep: true })

// 关闭面板
const handleClose = () => {
  emit('update:visible', false)
}

// 取消
const handleCancel = () => {
  localSettings.value = { ...props.settings }
  handleClose()
}

// 确定
const handleConfirm = () => {
  emit('save', localSettings.value)
  handleClose()
}

// 切换设置项
const toggleSetting = (key) => {
  localSettings.value[key] = !localSettings.value[key]
}
</script>

<template>
  <Transition name="settings-fade">
    <div v-if="visible" class="settings-overlay" @click="handleClose">
      <Transition name="settings-slide">
        <div v-if="visible" class="settings-panel" @click.stop>
          <!-- 头部 -->
          <div class="settings-header">
            <div class="settings-title">
              <span class="settings-icon">⚙️</span>
              <span class="settings-label">设置</span>
            </div>
            <button class="close-btn" @click="handleClose">
              <span>✕</span>
            </button>
          </div>

          <!-- 内容 -->
          <div class="settings-content">
            <div class="settings-section">
              <h3 class="section-title">翻译输出设置</h3>
              <div class="settings-list">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-name">显示音标</span>
                    <span class="setting-desc">显示单词的音标信息</span>
                  </div>
                  <button
                    class="toggle-switch"
                    :class="{ active: localSettings.showPhonetic }"
                    @click="toggleSetting('showPhonetic')"
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-name">显示释义</span>
                    <span class="setting-desc">显示单词的详细释义</span>
                  </div>
                  <button
                    class="toggle-switch"
                    :class="{ active: localSettings.showDefinitions }"
                    @click="toggleSetting('showDefinitions')"
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-name">显示例句</span>
                    <span class="setting-desc">显示单词的使用例句</span>
                  </div>
                  <button
                    class="toggle-switch"
                    :class="{ active: localSettings.showExamples }"
                    @click="toggleSetting('showExamples')"
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-name">显示变量命名</span>
                    <span class="setting-desc">显示编程变量命名格式</span>
                  </div>
                  <button
                    class="toggle-switch"
                    :class="{ active: localSettings.showVariableNaming }"
                    @click="toggleSetting('showVariableNaming')"
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-name">显示语境说明</span>
                    <span class="setting-desc">显示单词的使用语境</span>
                  </div>
                  <button
                    class="toggle-switch"
                    :class="{ active: localSettings.showContextNote }"
                    @click="toggleSetting('showContextNote')"
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="settings-footer">
            <button class="btn-cancel" @click="handleCancel">取消</button>
            <button class="btn-confirm" @click="handleConfirm">确定</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩层 */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
}

/* 配置面板 */
.settings-panel {
  width: 420px;
  max-height: 80vh;
  background: white;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 头部 */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-icon {
  font-size: 20px;
}

.settings-label {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(226, 232, 240, 0.5);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text-secondary, #64748b);
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(226, 232, 240, 0.8);
  color: var(--text-primary, #1e293b);
}

/* 内容区域 */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.settings-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin: 0 0 16px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 设置项 */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border-radius: 10px;
  transition: background 0.2s;
}

.setting-item:hover {
  background: rgba(241, 245, 249, 1);
}

.setting-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

/* 开关按钮 */
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

/* 底部按钮 */
.settings-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid rgba(226, 232, 240, 0.6);
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  height: 40px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: rgba(226, 232, 240, 0.5);
  color: var(--text-secondary, #64748b);
}

.btn-cancel:hover {
  background: rgba(226, 232, 240, 0.8);
  color: var(--text-primary, #1e293b);
}

.btn-confirm {
  background: #6366f1;
  color: white;
}

.btn-confirm:hover {
  background: #5558e3;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

/* 滚动条样式 */
.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* 动画 */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.3s;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.settings-slide-enter-from,
.settings-slide-leave-to {
  transform: translateY(100%);
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  .settings-panel {
    background: #1e293b;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
  }

  .settings-header {
    border-bottom: 1px solid rgba(51, 65, 85, 0.6);
  }

  .settings-label {
    color: var(--text-primary, #f1f5f9);
  }

  .close-btn {
    background: rgba(51, 65, 85, 0.5);
    color: var(--text-secondary, #94a3b8);
  }

  .close-btn:hover {
    background: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .section-title {
    color: var(--text-secondary, #94a3b8);
  }

  .setting-item {
    background: rgba(15, 23, 42, 0.6);
  }

  .setting-item:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .setting-name {
    color: var(--text-primary, #f1f5f9);
  }

  .setting-desc {
    color: var(--text-secondary, #64748b);
  }

  .toggle-switch {
    background: rgba(71, 85, 105, 0.8);
  }

  .settings-footer {
    border-top: 1px solid rgba(51, 65, 85, 0.6);
  }

  .btn-cancel {
    background: rgba(51, 65, 85, 0.5);
    color: var(--text-secondary, #94a3b8);
  }

  .btn-cancel:hover {
    background: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .settings-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .settings-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

/* 响应式 */
@media (max-width: 768px) {
  .settings-panel {
    width: 100%;
    max-height: 90vh;
  }
}
</style>
