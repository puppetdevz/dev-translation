# 设置页面重构设计

## 日期

2026-05-29

## 动机

当前设置面板存在两个核心问题：

1. **抽屉式模态框体验差**：420px 宽度空间局促，从右下角滑入动画不流畅，设置无法与主界面同时查看
2. **设置层级不合理**：翻译输出设置未按引擎分组，不同引擎支持的能力不同，当前扁平布局无法体现依赖关系

## 设计目标

- 将设置页改为全屏页面，提供充足空间
- 按引擎组织输出设置：全局设置 → 引擎选择 → 引擎专属输出设置
- 所有开关实时生效，无需确认/取消操作
- 与现有底部 footer 的 AI/G 切换按钮保持双向同步
- 保持现有 UI 设计系统一致性

## 页面布局

```
┌──────────────────────────────────────┐
│  ← 返回          设置                 │  ← 顶栏
├──────────────────────────────────────┤
│  语言检测策略                          │  ← 全局设置，始终可见
│  ○ 正则算法    ○ AI 模型              │
├──────────────────────────────────────┤
│  翻译引擎                              │  ← 引擎选择，与底部按钮同步
│  ┌─────────────┐  ┌─────────────┐    │
│  │  🤖 AI 模型  │  │  🌐 Google   │    │
│  └─────────────┘  └─────────────┘    │
├──────────────────────────────────────┤
│  翻译输出设置                          │  ← 引擎专属，随 Tab 切换
│                                      │
│  AI 模型（5 项）：                      │
│  显示音标          [Toggle]           │
│  显示释义          [Toggle]           │
│  显示例句          [Toggle]           │
│  显示变量命名      [Toggle]           │
│  显示语境说明      [Toggle]           │
│                                      │
│  Google 翻译（3 项）：                  │
│  显示音标          [Toggle]           │
│  显示释义          [Toggle]           │
│  显示变量命名      [Toggle]           │
└──────────────────────────────────────┘
```

## 设置项详解

### 全局设置（不受引擎影响）

- **语言检测策略**：正则算法 | AI 模型，单选互斥
- 两个引擎共用同一检测策略

### AI 模型专属（5 项 Toggle）

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| showPhonetic | AI 生成美式 IPA 音标 | true |
| showDefinitions | AI 生成 3-5 条英文释义 | true |
| showExamples | AI 生成 3-5 条英文例句 | true |
| showVariableNaming | 基于翻译结果生成 5 种编程命名 | true |
| showContextNote | AI 补充单词使用场景说明 | true |

### Google 翻译专属（3 项 Toggle）

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| showPhonetic | 词典查询获取音标 | true |
| showDefinitions | 词典查询获取释义 | true |
| showVariableNaming | 基于翻译结果生成 5 种编程命名 | true |

Google 翻译不支持 AI，故无 showExamples 和 showContextNote。

## 交互行为

### 路由

- `App.vue` 新增 `currentView` 状态（'translate' | 'settings'），控制页面互斥切换
- 点击底部 ⚙️ → Translate emit 'openSettings'，App 切换 currentView
- 点击设置页顶栏返回箭头 → SettingsPage emit 'back'，App 切回 translate

### 开关行为

- **实时生效**：Toggle 切换立即调用 `saveSettings()` 持久化，无取消/确认按钮
- **引擎 Tab**：点击直接更新 `translationEngine`，同步到底部 footer 的 AI/G 按钮
- **语言检测**：点击直接更新 `detectionStrategy`

### 底部 Footer 同步

- 设置页引擎 Tab 切换 ↔ 底部 AI/G 按钮，通过共享 `settings` 对象双向绑定
- 底部变量命名按钮保持不变

## 状态管理

`App.vue` 持有 `settings` 响应式状态（loadSettings 初始化），作为唯一数据源传递给 `Translate` 和 `SettingsPage`。两个页面按需保存到 storage，App.vue 监听 settings 变化同步写存储。

```
App.vue
 ├── settings (ref, 唯一数据源)
 ├── Translate (接收 settings, 底部按钮修改 settings)
 └── SettingsPage (接收 settings, 所有开关修改 settings)
```

两个页面互斥渲染（同一时刻只显示一个），因此无需担心并发写冲突。

## 组件变更

### 新建

- `src/Translate/components/SettingsPage.vue`：全屏设置页面

### 废弃/移除

- `src/Translate/components/SettingsPanel.vue`：当前抽屉式配置面板

### 修改

- `src/App.vue`：持有 settings 状态，新增 `currentView` 内部路由（'translate' | 'settings'），下载 settings 给两个页面
- `src/Translate/index.vue`：移除内联 settings 定义、SettingsPanel 引用、openSettings；settings 改为 props 传入

## 技术注意点

### 设置持久化

沿用现有 `src/Translate/utils/storage.js`，使用 `window.utools.dbStorage` API。存储结构不变，所有字段保持兼容。

### 引擎切换时的输出设置

切换引擎 Tab 不会丢失另一个引擎的设置。所有设置保存在同一个对象中，全局生效。切换引擎时仅切换 visibility 逻辑，不修改设置值。

### 深色模式

遵循 CLAUDE.md 中的设计系统，完整适配 `prefers-color-scheme: dark`。

### 响应式

- 移动端（< 768px）：内容区域自适应宽度
- 小窗口（< 550px）：保持可用，不隐藏内容

## 测试要点

- [ ] 点击底部 ⚙️ 进入设置页，返回箭头回到主界面
- [ ] 引擎 Tab 切换与底部 AI/G 按钮双向同步
- [ ] AI Tab 显示 5 项输出设置，Google Tab 显示 3 项
- [ ] 所有 Toggle 实时保存，刷新后保持状态
- [ ] 语言检测策略单选正常工作
- [ ] 深色模式样式正确
- [ ] 移动端响应式布局
- [ ] 引擎切换不丢失设置值
- [ ] 无视觉跳动（布局稳定性）
