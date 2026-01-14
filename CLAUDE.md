# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 uTools 插件项目，名为 "Dev Translation"（开发者翻译）。使用 Vue 3 + Vite 构建，提供智能中英文互译功能，具备现代化的 UI 设计和流畅的用户体验。

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **构建工具**: Vite 6.x
- **包管理器**: pnpm
- **运行环境**: uTools 插件环境（支持 Node.js API）
- **AI 服务**: uTools AI API

## 常用命令

```bash
# 开发模式（启动 Vite 开发服务器）
pnpm dev

# 构建生产版本
pnpm build
```

## 项目架构

### 目录结构

```
.
├── public/
│   ├── plugin.json          # uTools 插件配置文件
│   └── preload/
│       └── services.js      # Node.js 能力注入（preload 脚本）
├── src/
│   ├── main.js              # Vue 应用入口
│   ├── App.vue              # 根组件（路由控制）
│   └── Translate/           # 翻译功能模块
│       ├── index.vue        # 翻译主组件
│       ├── prompts/         # AI 提示词模块
│       │   ├── index.js                # 提示词索引文件
│       │   ├── chineseToEnglish.js     # 中译英提示词
│       │   ├── englishToChinese.js     # 英译中提示词
│       │   └── polish.js               # 文本润色提示词
│       └── components/      # 翻译子组件
│           ├── InputArea.vue           # 输入区域组件
│           ├── ResultDisplay.vue       # 结果展示组件
│           └── KeyboardShortcuts.vue   # 快捷键提示组件
├── documents/               # 文档资源
│   └── image.png           # 项目截图
├── index.html               # HTML 入口
├── vite.config.js           # Vite 配置
├── jsconfig.json            # JS 配置（包含 utools-api-types）
├── CLAUDE.md                # 项目架构和开发指南
└── TESTING.md               # 测试指南
```

### 核心架构

#### 1. uTools 插件系统

- **plugin.json**: 定义插件的功能入口（features）、命令（cmds）和开发配置
- **preload/services.js**: 在 preload 阶段注入 Node.js 能力到 `window.services`，提供文件系统访问
- **开发模式**: 配置了 `development.main` 指向 `http://localhost:5173`，支持热重载开发

#### 2. 路由系统

项目使用简单的条件渲染实现路由，而非 Vue Router：

- `App.vue` 监听 `window.utools.onPluginEnter` 事件获取 `action.code`
- 根据 `action.code` 渲染对应的功能组件（目前仅 translate）
- 每个功能组件接收 `enterAction` prop，包含用户输入和上下文信息

#### 3. 翻译功能模块

**Translate 模块** (`src/Translate/index.vue`):
- 智能中英文互译功能
- 文本润色功能（易于理解且保留专业性）
- 使用 uTools AI API 进行翻译和润色
- 自动语言检测（基于正则表达式）
- 支持关键词触发和文本选择触发
- 显示翻译结果、音标、释义、例句

**AI 提示词模块** (`src/Translate/prompts/`):
- **模块化管理**: 所有 AI 提示词集中在 prompts 子文件夹中
- **chineseToEnglish.js**: 中译英提示词模板
  - 返回格式: JSON (translation, phonetic, definitions, examples)
  - 音标要求: 美式 IPA 格式
  - 释义和例句: 3-5 个英文释义和例句
- **englishToChinese.js**: 英译中提示词模板
  - 返回格式: JSON (translation, phonetic, definitions, examples)
  - 音标要求: 原文美式 IPA 格式
  - 释义和例句: 3-5 个英文释义和例句（保持英文）
- **polish.js**: 文本润色提示词模板
  - 返回格式: 纯文本
  - 润色风格: 易于理解但保留适当专业性
  - 支持中英文自动识别
- **index.js**: 统一导出所有提示词函数

**子组件架构**:

1. **InputArea.vue** - 输入区域组件
   - 语言检测徽章（带国旗图标 🇨🇳/🇺🇸）
   - 实时字数统计（超过 4500 字符显示警告）
   - 渐变背景和毛玻璃效果
   - 三个操作按钮：清空、润色、翻译
   - 润色对比视图：原文与润色后文本并排显示
   - 采纳/拒绝按钮：用户可选择是否应用润色结果
   - 按钮带图标和加载动画
   - 点击波纹效果
   - 支持 Enter 翻译、Shift+Enter 换行
   - 组件挂载后自动聚焦到输入框
   - 语言徽章和字数统计移至输入框下方，仅在非润色模式下显示

2. **ResultDisplay.vue** - 结果展示组件
   - 紧凑的响应式网格布局（CSS Grid）
   - 智能单词/字符数量检测，根据翻译结果显示不同内容：
     - **单词数 ≤ 3**: 显示音标
     - **单词数 ≤ 5**: 显示变量命名样式 + 音标
     - **单词数 > 5**: 仅显示翻译结果
   - 翻译结果卡片：
     - 包含翻译结果和条件显示的音标
     - 复制按钮仅复制翻译结果
     - 占据整行，突出显示
   - 变量命名样式卡片（单词数 ≤ 5 时显示）：
     - 生成 5 种常见命名风格：PascalCase、camelCase、snake_case、UPPER_CASE、kebab-case
     - 支持点击整行复制命名结果，无需精确点击代码
     - 卡片标题显示"点击复制"提示文字
     - 悬停时显示复制图标 📋 和高亮效果
     - 点击后显示具体复制的内容（如"已复制: HelloWorld"）
     - 网格布局，自适应显示
   - 释义和例句合并卡片：
     - 显示前 3 个释义和前 2 个例句
     - 水平排列，用分隔符连接
     - 紧凑布局，节省空间
   - 优雅的加载动画（三个跳动的圆点）
   - 卡片悬停上浮效果和淡入动画
   - 所有内容可在屏幕内一次性显示，无需滚动
   - 空状态保持空白，不显示任何提示信息
   - 深色模式完整适配

3. **KeyboardShortcuts.vue** - 快捷键提示组件
   - 3D 按键效果
   - 分隔线设计
   - 悬停动画
   - 简洁的快捷键显示

#### 4. UI 设计系统

**设计理念**:
- **高信息密度**: 通过布局优化而非简单缩小字体来提高信息密度
- **紧凑布局**: 减少不必要的空白和冗余元素
- **一屏显示**: 所有内容一次性展示在屏幕内，无需滚动
- **内容优先**: 精简显示内容（释义 3 个、例句 2 个）

**设计特点**:
- **现代化风格**: 渐变色彩 (#667eea → #764ba2)、毛玻璃效果、柔和阴影
- **流式布局**: CSS Grid 自适应网格、Flexbox 弹性布局、支持窗口拉伸
- **响应式设计**:
  - 大屏幕 (> 1024px): 释义和例句并排显示，充分利用横向空间
  - 中等屏幕 (768-1024px): 单列布局，垂直堆叠
  - 小屏幕 (< 768px): 更紧凑的间距和更小的字号
  - 小窗口高度 (< 600px): 极简布局，隐藏快捷键提示
  - 超小窗口高度 (< 400px): 最小化间距和字号
- **深色模式**: 完整的深色主题支持，自动适配系统主题
- **动画效果**: 淡入、上浮、波纹、加载动画等

**布局优化策略**:
```css
/* 紧凑网格布局 */
.result-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px; /* 减小间距 */
}

/* 合并翻译和音标 */
.translation-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

/* 精简内容显示 */
.definitions { display: first 3 items; }
.examples { display: first 2 items; }
```

**颜色系统**:
```css
/* 主色调 */
--primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* 背景 */
--bg-light: linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%);
--bg-dark: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);

/* 文本 */
--text-primary-light: #2c3e50;
--text-primary-dark: #e0e0e0;
--text-secondary-light: #8492a6;
--text-secondary-dark: #a0aec0;
```

#### 5. Node.js 能力注入

`public/preload/services.js` 通过 preload 机制注入以下能力：

- `readFile(file)`: 同步读取文件内容
- `writeTextFile(text)`: 将文本写入下载目录
- `writeImageFile(base64Url)`: 将 base64 图片写入下载目录

注意：当前翻译功能不需要文件系统访问，这些能力为未来功能扩展预留。

## 开发注意事项

### uTools API 使用

- 所有 uTools API 通过 `window.utools` 访问
- 类型定义来自 `utools-api-types` 包
- 常用 API：
  - `onPluginEnter(callback)`: 监听插件进入
  - `onPluginOut(callback)`: 监听插件退出
  - `showOpenDialog(options)`: 打开文件选择对话框
  - `showNotification(message)`: 显示通知
  - `shellShowItemInFolder(path)`: 在文件管理器中显示文件
  - `getPath(name)`: 获取系统路径（如 'downloads'）
  - `ai(options, callback)`: 调用 AI API（用于翻译功能）

### uTools AI API

翻译功能使用 uTools AI API：

```javascript
// 非流式调用
const result = await window.utools.ai({
  messages: [{ role: 'user', content: prompt }]
})

// 流式调用
await window.utools.ai({ messages }, (chunk) => {
  console.log(chunk)
})
```

**注意事项**：
- AI 响应可能不总是标准 JSON 格式，需要多层解析策略
- 音标由 AI 生成，可能需要人工验证
- 需要用户在 uTools 中配置 AI 服务

### Preload 脚本

- `public/preload/services.js` 使用 CommonJS 格式（Node.js 环境）
- 可以使用所有 Node.js 内置模块（如 fs, path）
- 通过 `window` 对象向渲染进程注入能力

### Vite 配置

- `base: './'`: 使用相对路径，适配 uTools 插件环境
- 开发时 Vite 运行在 `localhost:5173`，uTools 通过 `plugin.json` 的 `development.main` 加载

### Vue 组件规范

- 使用 Composition API (`<script setup>`)
- 组件使用 `lang="ts"` 但实际是 JavaScript（用于类型提示）
- Props 使用 `defineProps` 定义，包含类型和必填校验

### 翻译功能实现细节

**语言检测**：
```javascript
const detectLanguage = (text) => {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0
  return chineseRatio > 0.3 ? 'zh' : 'en'
}
```

**AI Prompt 策略**：
- 所有 AI 提示词集中在 `src/Translate/prompts/` 模块中管理
- 在 `index.vue` 中通过 `import` 导入所需的提示词函数
- 中译英：要求返回英文翻译、美式音标、英文释义、英文例句
- 英译中：要求返回中文翻译、英文音标、英文释义、英文例句
- 文本润色：要求以易于理解但保留适当专业性的风格重写
- 使用 JSON 格式返回，便于解析

**结果解析**：
- 尝试直接解析 JSON
- 提取 markdown 代码块中的 JSON
- 提取花括号内容
- 多层容错机制

**UI 交互细节**：
- 输入框聚焦时显示紫色边框和阴影
- 按钮悬停时上浮 1-2px
- 卡片悬停时上浮 2px 并增强阴影
- 加载时显示三个跳动的圆点动画
- 结果卡片淡入动画 (0.4s)
- 语言徽章淡入缩放动画 (0.3s)
- 输入框禁用手动调整大小，防止溢出
- 自定义滚动条样式（紫色半透明）
- 润色对比视图：
  - 左右并排显示原文和润色后文本
  - 润色面板带紫色高亮边框
  - 移动端自动切换为上下堆叠布局
  - 采纳按钮（绿色）应用润色结果
  - 拒绝按钮（红色）放弃润色结果

**响应式布局实现**：
```css
/* 网格布局 - 自动适应 */
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

/* 翻译卡片占据整行 */
.translation-card.full-width {
  grid-column: 1 / -1;
}

/* 中小屏幕 - 单列 */
@media (max-width: 1024px) {
  .result-grid {
    grid-template-columns: 1fr;
  }
}

/* 小窗口高度优化 */
@media (max-height: 600px) {
  .translate-footer {
    display: none; /* 隐藏快捷键提示 */
  }
}
```

**布局优化原则**：
1. **合并相关元素**: 翻译结果和音标在同一卡片
2. **减少视觉层级**: 移除冗余标题和文字
3. **精简内容**: 只显示最重要的释义和例句
4. **紧凑间距**: 所有 padding 和 margin 最小化
5. **响应式网格**: 利用横向空间并排显示卡片
6. **按钮简化**: 复制按钮仅保留图标

## 插件功能扩展

添加新功能需要：

1. 在 `plugin.json` 的 `features` 数组中添加新功能配置
2. 在 `src/` 下创建新的功能组件目录
3. 在 `App.vue` 中添加对应的路由条件渲染
4. 如需 Node.js 能力，在 `preload/services.js` 中添加相应方法

## 测试

详细的测试指南请参考 `TESTING.md` 文件。

主要测试点：
- 关键词触发（"翻译"、"translate"、"fanyi"）
- 文本选择触发
- 中译英功能
- 英译中功能
- 文本润色功能
- 润色对比视图显示
- 采纳/拒绝润色结果
- 语言自动检测
- 错误处理
- 深色模式适配
- 快捷键功能（Enter 翻译、Shift+Enter 换行、Esc 关闭）
- 响应式布局（窗口拉伸、不同屏幕尺寸）
- UI 动画效果（加载、悬停、淡入等）
- 复制功能

## 性能优化

- 使用 CSS Grid 和 Flexbox 实现高效布局
- 动画使用 transform 和 opacity，避免触发重排
- 组件按需加载
- 合理使用 Vue 的响应式系统
- 自定义滚动条样式优化
- 内容精简显示（释义 3 个、例句 2 个），减少 DOM 节点
- 合并相关元素（翻译结果和音标），减少卡片数量
- 使用 `box-sizing: border-box` 确保正确尺寸计算
- 输入框禁用 `resize`，避免用户调整造成布局抖动
- 使用 `slice(0, n)` 限制数组渲染数量，提升渲染性能

## 未来扩展方向

- 支持更多语言对（如日语、韩语等）
- 添加翻译历史记录
- 支持批量翻译
- 添加发音功能
- 支持自定义 AI 模型
- 添加专业术语词典
- 支持翻译结果导出

## 开发建议

1. **保持 UI 一致性**: 遵循现有的设计系统（颜色、间距、圆角、阴影等）
2. **响应式优先**: 确保新功能在不同屏幕尺寸下都能正常工作
3. **深色模式支持**: 所有新增样式都要考虑深色模式
4. **动画流畅性**: 使用 transform 和 opacity，避免性能问题
5. **错误处理**: 提供友好的错误提示和重试机制
6. **代码组织**: 保持组件化，单一职责原则
7. **注释规范**: 关键逻辑添加注释说明
8. **高信息密度优先**:
   - 通过布局优化而非简单缩小字体来提高信息密度
   - 合并相关元素，减少卡片数量
   - 精简显示内容，只保留最重要信息
   - 充分利用横向空间，采用并排布局
   - 目标是"一屏显示"，用户无需滚动即可查看所有内容
9. **性能意识**:
   - 使用 `slice(0, n)` 限制数组渲染数量
   - 避免不必要的 DOM 节点
   - 使用 `box-sizing: border-box` 确保尺寸计算正确
   - 禁用用户可调整大小的元素（如 `resize: none`）
