# Google Translate Integration Design

**日期**: 2026-05-29
**状态**: 已确认

## 概述

在现有 uTools AI 翻译基础上，新增 Google 翻译引擎作为可选方案。用户可在设置面板和主界面底部快捷切换翻译引擎。Google 翻译结果通过 Free Dictionary API 补充音标、释义、例句，保持与 AI 翻译一致的数据格式。

## 依赖

- [googletrans](https://github.com/DarinRowe/googletrans) — Node.js 库，免费无限制 Google 翻译 API
- [Free Dictionary API](https://dictionaryapi.dev/) — 免费词典 API，提供音标、释义、例句

## 架构

### 翻译引擎选择流程

```
用户点击"翻译"
  → 判断 settings.translationEngine
  → 'ai':     现有逻辑，window.utools.ai() → 结构化 JSON
  → 'google': window.services.googleTranslate() → 纯文本
              → window.services.lookupWord()   → 音标/释义（单词模式）
                英译中并行，中译英需等翻译结果
              → 合并为统一格式返回前端
```

### Preload 层

`googletrans` 通过 `public/preload/services.js` 调用，注入到 `window.services`：

- `googleTranslate(text, from, to)` — 返回纯文本译文
- `lookupWord(word)` — 调用 Free Dictionary API，返回 `{ phonetic, definitions, examples }`

### 前端层

`src/Translate/index.vue` 的 `translate()` 函数中新增引擎分支判断，Google 路径下调用 `window.services` 方法，拼装为 `ResultDisplay` 可消费的统一 JSON 格式。

## 数据流

### Google 翻译路径（单词/短语）

**查找词选择**：始终查英文单词（Free Dictionary API 仅支持英文）。

**英译中（并行）**：
```
googleTranslate(text, 'en', 'zh-CN') + lookupWord(text) → 并行
合并: { translation, phonetic, definitions, examples }
```

**中译英（串行）**：
```
1. googleTranslate(text, 'zh-CN', 'en') → 拿到英文译文 result
2. lookupWord(result) → 用英文译文查词典
3. 合并: { translation: result, phonetic, definitions, examples }
```

### Google 翻译路径（句子）

句子不查词典，仅返回翻译结果：`{ translation: "..." }`

### 词典 API 字段映射

| 词典字段 | 内部字段 |
|---------|---------|
| `phonetic` 或 `phonetics[0].text` | `phonetic` |
| `meanings[].partOfSpeech` | `definitions[].pos` |
| `meanings[].definitions[].definition` | `definitions[].meaning` |
| `meanings[].definitions[].example` | `definitions[].example` |

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| Google 翻译失败 | 显示错误提示，建议切换至 AI 模式重试 |
| 词典查询失败 | 静默降级，翻译结果照常显示，音标/释义留空 |
| Google 翻译超时（>10s） | 自动取消，提示超时 |
| preload 未加载 services | 前端检测，不存在时降级为 AI |

## 界面变更

### 1. 设置面板 — 新增「翻译引擎」section

在「语言检测策略」上方新增，与策略选择样式一致（单选、紫色高亮边框）：

- AI 模型：结构化翻译，含音标释义
- Google 翻译：免费快速，词典补充音标

### 2. 底部 Footer — 新增引擎切换按钮

左侧按钮组改为两个并排（引擎 + 变量命名），布局从 `32px 1fr 32px` 改为 `auto 1fr 32px`：

- 引擎按钮：圆形图标，Google 模式紫色高亮，AI 模式灰色默认
- 点击直接切换并保存，无需确认

### 3. ResultDisplay 无改动

preload 层拼装好统一格式，组件接收的数据结构不变。音标/释义/例句开关始终可用（词典 API 补充）。

## 设置存储

新增 `translationEngine` 字段到 `DEFAULT_SETTINGS`：

```js
{
  // ...existing fields
  translationEngine: 'ai',  // 'ai' | 'google'
}
```

## 润色功能

不受翻译引擎设置影响，始终使用 uTools AI。
