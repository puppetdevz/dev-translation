<template>
  <div class="settings-container">
    <div class="settings-card">
      <!-- 标题栏 -->
      <div class="settings-header">
        <h2 class="settings-title">输出内容设置</h2>
        <button class="close-btn" @click="goBack" title="返回">
          <span>✕</span>
        </button>
      </div>

      <!-- 设置选项列表 -->
      <div class="settings-list">
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">显示音标</span>
            <span class="setting-desc">显示单词的美式音标</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.showPhonetic" @change="handleChange">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">显示释义</span>
            <span class="setting-desc">显示单词的英文释义</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.showDefinitions" @change="handleChange">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">显示例句</span>
            <span class="setting-desc">显示单词的英文例句</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.showExamples" @change="handleChange">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">显示变量命名样式</span>
            <span class="setting-desc">显示 PascalCase、camelCase 等命名风格</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.showVariableNaming" @change="handleChange">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">显示上下文说明</span>
            <span class="setting-desc">显示翻译的上下文和使用场景</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.showContextNote" @change="handleChange">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="settings-footer">
        <button class="reset-btn" @click="handleReset">
          <span class="btn-icon">↺</span>
          <span>恢复默认</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { loadSettings, saveSettings, resetSettings } from '../Translate/utils/storage.js'

const settings = ref({
  showPhonetic: true,
  showDefinitions: true,
  showExamples: true,
  showVariableNaming: true,
  showContextNote: true,
})

// 加载设置
onMounted(() => {
  settings.value = loadSettings()
})

// 设置变更时保存
const handleChange = () => {
  const success = saveSettings(settings.value)
  if (success) {
    // 显示保存成功提示（可选）
    console.log('设置已保存')
  }
}

// 重置设置
const handleReset = () => {
  settings.value = resetSettings()
  window.utools?.showNotification('已恢复默认设置')
}

// 返回翻译界面
const router = useRouter()

const goBack = () => {
  if (window.utools) {
    window.utools.redirect('翻译', '')
  } else {
    router.push({ name: 'translate' })
  }
}
</script>

<style scoped>
.settings-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.settings-card {
  width: 100%;
  max-width: 600px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(226, 232, 240, 0.8);
  overflow: hidden;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
}

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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
  transition: all 0.2s;
  font-size: 18px;
  color: #64748b;
}

.close-btn:hover {
  background: rgba(226, 232, 240, 0.8);
  transform: translateY(-1px);
}

.settings-list {
  padding: 12px 0;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 28px;
  transition: background 0.2s;
}

.setting-item:hover {
  background: rgba(248, 250, 252, 0.8);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label {
  font-size: 15px;
  font-weight: 500;
  color: #1e293b;
}

.setting-desc {
  font-size: 13px;
  color: #64748b;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #cbd5e1;
  border-radius: 26px;
  transition: all 0.3s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.toggle-switch input:checked + .toggle-slider {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(22px);
}

.settings-footer {
  padding: 20px 28px;
  border-top: 1px solid rgba(226, 232, 240, 0.6);
  display: flex;
  justify-content: center;
}

.reset-btn {
  padding: 10px 24px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: rgba(248, 250, 252, 0.8);
  border-color: rgba(226, 232, 240, 1);
  transform: translateY(-1px);
}

.btn-icon {
  font-size: 16px;
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  .settings-container {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  }

  .settings-card {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .settings-header {
    border-bottom-color: rgba(51, 65, 85, 0.6);
  }

  .settings-title {
    color: #f1f5f9;
  }

  .close-btn {
    background: rgba(51, 65, 85, 0.5);
    color: #94a3b8;
  }

  .close-btn:hover {
    background: rgba(51, 65, 85, 0.8);
  }

  .setting-item:hover {
    background: rgba(15, 23, 42, 0.5);
  }

  .setting-label {
    color: #f1f5f9;
  }

  .setting-desc {
    color: #94a3b8;
  }

  .toggle-slider {
    background: #475569;
  }

  .settings-footer {
    border-top-color: rgba(51, 65, 85, 0.6);
  }

  .reset-btn {
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.8);
    color: #94a3b8;
  }

  .reset-btn:hover {
    background: rgba(15, 23, 42, 0.5);
    border-color: rgba(51, 65, 85, 1);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .settings-container {
    padding: 20px 12px;
  }

  .settings-header {
    padding: 20px 20px;
  }

  .setting-item {
    padding: 16px 20px;
  }

  .settings-footer {
    padding: 16px 20px;
  }

  .setting-label {
    font-size: 14px;
  }

  .setting-desc {
    font-size: 12px;
  }
}
</style>
