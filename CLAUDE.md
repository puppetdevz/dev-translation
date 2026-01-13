# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 uTools 插件项目，名为 "Dev Translation"（开发者翻译）。使用 Vue 3 + Vite 构建，提供文件读写和智能翻译等功能。

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
│   ├── Hello/               # Hello 功能模块
│   ├── Read/                # 读文件功能模块
│   ├── Write/               # 写文件功能模块
│   └── Translate/           # 翻译功能模块（新增）
│       ├── index.vue        # 翻译主组件
│       └── components/      # 翻译子组件
│           ├── InputArea.vue
│           ├── ResultDisplay.vue
│           └── KeyboardShortcuts.vue
├── index.html               # HTML 入口
├── vite.config.js           # Vite 配置
├── jsconfig.json            # JS 配置（包含 utools-api-types）
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
- 根据 `action.code` 渲染对应的功能组件（hello/read/write/translate）
- 每个功能组件接收 `enterAction` prop，包含用户输入和上下文信息

#### 3. 功能模块

**Hello 模块** (`src/Hello/index.vue`):
- 展示插件进入参数
- 用于调试和演示

**Read 模块** (`src/Read/index.vue`):
- 支持两种方式读取文件：
  1. 通过 uTools 文件匹配（拖拽文件到 uTools）
  2. 通过 `utools.showOpenDialog` 手动选择文件
- 使用 `window.services.readFile` 读取文件内容

**Write 模块** (`src/Write/index.vue`):
- 支持保存文本和图片到下载目录
- 使用 `window.services.writeTextFile` 和 `window.services.writeImageFile`
- 保存后自动在文件管理器中显示文件位置

**Translate 模块** (`src/Translate/index.vue`):
- 智能中英文互译功能
- 使用 uTools AI API 进行翻译
- 自动语言检测（基于正则表达式）
- 支持关键词触发和文本选择触发
- 显示翻译结果、音标、释义、例句
- 子组件：
  - `InputArea.vue`: 输入区域，支持语言检测指示器、字数统计
  - `ResultDisplay.vue`: 结果展示，卡片式布局
  - `KeyboardShortcuts.vue`: 快捷键提示

#### 4. Node.js 能力注入

`public/preload/services.js` 通过 preload 机制注入以下能力：

- `readFile(file)`: 同步读取文件内容
- `writeTextFile(text)`: 将文本写入下载目录
- `writeImageFile(base64Url)`: 将 base64 图片写入下载目录

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
- 中译英：要求返回英文翻译、美式音标、英文释义、英文例句
- 英译中：要求返回中文翻译、英文音标、英文释义、英文例句
- 使用 JSON 格式返回，便于解析

**结果解析**：
- 尝试直接解析 JSON
- 提取 markdown 代码块中的 JSON
- 提取花括号内容
- 多层容错机制

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
- 语言自动检测
- 错误处理
- 深色模式适配
- 快捷键功能
