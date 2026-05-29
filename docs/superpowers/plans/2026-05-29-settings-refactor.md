# 设置页面重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将抽屉式设置面板替换为全屏设置页面，按引擎组织输出设置子项

**Architecture:** 新增 Vue Router `/settings` 路由渲染全屏 SettingsPage；提取 useSettings 组合式函数作为 settings 状态的唯一数据源（替代各组件内联定义）；Translate 和 SettingsPage 通过组合式函数共享状态；废弃抽屉式 SettingsPanel

**Tech Stack:** Vue 3 (Composition API), Vue Router (Hash History), uTools dbStorage

---

### Task 1: 创建 useSettings 组合式函数

**File:**
- Create: `src/Translate/utils/useSettings.js`

- [ ] **Step 1: 编写 useSettings 组合式函数**

```javascript
import { ref, watch } from 'vue'

const STORAGE_KEY = 'dev-translation-settings'

const DEFAULT_SETTINGS = {
  showPhonetic: true,
  showDefinitions: true,
  showExamples: true,
  showVariableNaming: true,
  showContextNote: true,
  detectionStrategy: 'regex',
  translationEngine: 'ai',
}

// 模块级单例，router 切换时保持状态
const settings = ref({ ...DEFAULT_SETTINGS })

let initialized = false

const loadFromStorage = () => {
  try {
    const stored = window.utools?.dbStorage?.getItem(STORAGE_KEY)
    if (stored) {
      settings.value = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

const saveToStorage = (value) => {
  try {
    window.utools?.dbStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

export function useSettings() {
  if (!initialized) {
    loadFromStorage()
    initialized = true
  }

  // 监听变化并持久化
  watch(settings, (newValue) => {
    saveToStorage(newValue)
  }, { deep: true })

  const updateSetting = (key, value) => {
    settings.value = { ...settings.value, [key]: value }
  }

  const toggleSetting = (key) => {
    settings.value = { ...settings.value, [key]: !settings.value[key] }
  }

  return { settings, updateSetting, toggleSetting }
}
```

- [ ] **Step 2: 验证模块导入路径正确**

运行: `ls src/Translate/utils/useSettings.js`
预期: 文件存在

- [ ] **Step 3: 提交**

```bash
git add src/Translate/utils/useSettings.js
git commit -m "feat: add useSettings composable for shared settings state"
```

---

### Task 2: 添加 /settings 路由

**Files:**
- Modify: `src/router.js`

- [ ] **Step 1: 添加 settings 路由**

```javascript
import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/translate',
    name: 'translate',
    component: () => import('./Translate/index.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./Translate/components/SettingsPage.vue'),
  },
  {
    path: '/',
    redirect: '/translate',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
```

- [ ] **Step 2: 提交**

```bash
git add src/router.js
git commit -m "feat: add /settings route for settings page"
```

---

### Task 3: 创建 SettingsPage.vue（全屏设置页面）

**Files:**
- Create: `src/Translate/components/SettingsPage.vue`

- [ ] **Step 1: 创建组件脚本部分**

```vue
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
```

- [ ] **Step 2: 创建组件模板部分**

```vue
<template>
  <div class="settings-page">
    <!-- 顶栏 -->
    <div class="settings-topbar">
      <button class="back-btn" @click="handleBack">
        <span>←</span>
      </button>
      <span class="topbar-title">设置</span>
    </div>

    <!-- 内容区域 -->
    <div class="settings-body">
      <!-- 语言检测策略 -->
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

      <!-- 翻译引擎 -->
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

      <!-- 翻译输出设置 -->
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
```

- [ ] **Step 3: 创建组件样式部分**

```vue
<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
}

/* 顶栏 */
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

/* 内容区域 */
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

/* 策略选项 */
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

/* 引擎 Tab */
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

/* 输出设置 */
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

/* 过渡动画 */
.output-fade-enter-active,
.output-fade-leave-active {
  transition: opacity 0.15s ease;
}

.output-fade-enter-from,
.output-fade-leave-to {
  opacity: 0;
}

/* 开关 */
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

/* 滚动条 */
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

/* 深色模式 */
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

/* 响应式 */
@media (max-width: 768px) {
  .settings-body {
    padding: 16px 12px;
  }
}
</style>
```

- [ ] **Step 4: 验证文件完整**

确认 `SettingsPage.vue` 包含 script、template、style 三部分，无缺失闭合标签。

- [ ] **Step 5: 提交**

```bash
git add src/Translate/components/SettingsPage.vue
git commit -m "feat: add full-screen SettingsPage component"
```

---

### Task 4: 重构 Translate/index.vue

**Files:**
- Modify: `src/Translate/index.vue`

- [ ] **Step 1: 替换 settings 状态管理，使用 useSettings**

将脚本中的内联 settings 定义替换为 useSettings 调用，并将底部 ⚙️ 按钮改为 router 导航。

修改脚本部分（仅列出变更行）：

**删除第 21-30 行**（内联 settings ref 定义和初始化）：
```javascript
// 删除这些行
const settings = ref({
  showPhonetic: true,
  showDefinitions: true,
  showExamples: true,
  showVariableNaming: true,
  showContextNote: true,
  detectionStrategy: 'regex',
  translationEngine: 'ai',
})
```

**在第 12 行后添加**：
```javascript
import { useSettings } from './utils/useSettings.js'
```

**添加 settings 获取**（在 props 定义之后）：
```javascript
const { settings, toggleSetting, updateSetting } = useSettings()
```

- [ ] **Step 2: 替换底部 ⚙️ 按钮为 router 导航**

在模板中找到 `settings-btn` 按钮，将 `@click="openSettings"` 改为 router push：

```vue
<button class="settings-btn" @click="router.push({ name: 'settings' })" title="设置">
```

同时在脚本中需要导入 useRouter：
```javascript
import { useRouter } from 'vue-router'
const router = useRouter()
```

- [ ] **Step 3: 移除废弃的代码**

删除以下代码：
- `openSettings` 函数（第 318-320 行）
- `showSettingsPanel` ref（第 47 行）
- `SettingsPanel` 导入（第 6 行）
- `SettingsPanel` 模板引用（第 454-458 行）
- `handleSaveSettings` 函数（第 323-326 行）改为直接使用 useSettings

- [ ] **Step 4: 简化 toggleVariableNaming 和 toggleTranslationEngine**

将 `toggleVariableNaming`（第 329-332 行）替换为：
```javascript
const toggleVariableNaming = () => {
  toggleSetting('showVariableNaming')
}
```

将 `toggleTranslationEngine`（第 334-340 行）替换为：
```javascript
const toggleTranslationEngine = () => {
  updateSetting('translationEngine',
    settings.value.translationEngine === 'ai' ? 'google' : 'ai')
}
```

- [ ] **Step 5: 删除 handleSaveSettings**

删除 `handleSaveSettings` 函数（第 323-326 行），因为 useSettings 中 watch 自动持久化。

- [ ] **Step 6: 构建验证**

运行: `pnpm build`
预期: 构建成功，无报错

- [ ] **Step 7: 提交**

```bash
git add src/Translate/index.vue
git commit -m "refactor: use useSettings composable in Translate, wire settings button to router"
```

---

### Task 5: 移除废弃的 SettingsPanel.vue

**Files:**
- Delete: `src/Translate/components/SettingsPanel.vue`

- [ ] **Step 1: 删除文件**

```bash
rm src/Translate/components/SettingsPanel.vue
```

- [ ] **Step 2: 构建验证**

运行: `pnpm build`
预期: 构建成功，无引用报错

- [ ] **Step 3: 提交**

```bash
git add src/Translate/components/SettingsPanel.vue
git commit -m "refactor: remove deprecated SettingsPanel component"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 构建检查**

运行: `pnpm build`
预期: 构建成功

- [ ] **Step 2: 检查未引用文件**

运行: `grep -r "SettingsPanel" src/`
预期: 无结果（确认没有残留引用）

- [ ] **Step 3: 检查 import 路径一致性**

运行: `grep -r "from.*useSettings" src/`
预期: 显示 `Translate/index.vue` 和 `SettingsPage.vue` 两个引用

- [ ] **Step 4: 最终提交（如有遗漏）**

如有任何调整，执行：
```bash
git add -A
git commit -m "chore: final cleanup for settings refactor"
```
