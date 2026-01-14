# AI 提示词模块

本目录包含所有 AI 提示词模板，用于翻译和润色功能。

## 文件结构

```
prompts/
├── index.js                # 统一导出所有提示词函数
├── chineseToEnglish.js     # 中译英提示词模板
├── englishToChinese.js     # 英译中提示词模板
└── polish.js               # 文本润色提示词模板
```

## 使用方法

### 导入提示词函数

```javascript
import {
  buildChineseToEnglishPrompt,
  buildEnglishToChinesePrompt,
  buildPolishPrompt
} from './prompts/index.js'
```

### 使用示例

#### 1. 中译英

```javascript
const prompt = buildChineseToEnglishPrompt('你好世界')
const result = await window.utools.ai({
  messages: [{ role: 'user', content: prompt }]
})
```

**返回格式**:
```json
{
  "translation": "Hello World",
  "phonetic": "/həˈloʊ wɜːrld/",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}
```

#### 2. 英译中

```javascript
const prompt = buildEnglishToChinesePrompt('Hello World')
const result = await window.utools.ai({
  messages: [{ role: 'user', content: prompt }]
})
```

**返回格式**:
```json
{
  "translation": "你好世界",
  "phonetic": "/həˈloʊ wɜːrld/",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}
```

#### 3. 文本润色

```javascript
const prompt = buildPolishPrompt('原始文本', 'zh') // 'zh' 或 'en'
const result = await window.utools.ai({
  messages: [{ role: 'user', content: prompt }]
})
```

**返回格式**: 纯文本（润色后的文本）

## 提示词设计原则

### 1. 明确的输出格式要求
- 翻译功能要求返回 JSON 格式
- 润色功能要求返回纯文本
- 避免 AI 返回额外的解释或 markdown 代码块

### 2. 具体的内容规范
- 音标: 美式 IPA 格式，如 `/ˈhɛloʊ/`
- 释义: 3-5 个英文释义
- 例句: 3-5 个英文例句
- 润色: 保持原文核心含义和专业性

### 3. 严格的格式约束
- 翻译: "直接返回JSON，不要使用markdown代码块"
- 润色: "仅返回润色后的文本，不要添加任何其他文字或解释"

## 修改提示词

如需修改提示词，请直接编辑对应的 `.js` 文件：

1. **chineseToEnglish.js** - 修改中译英的提示词模板
2. **englishToChinese.js** - 修改英译中的提示词模板
3. **polish.js** - 修改文本润色的提示词模板

修改后无需重启开发服务器，Vite 会自动热重载。

## 注意事项

1. **保持函数签名一致**: 不要修改函数名和参数
2. **测试 AI 响应**: 修改后务必测试 AI 返回的格式是否符合预期
3. **文档同步**: 如有重大修改，请同步更新 `CLAUDE.md` 文档
4. **版本控制**: 提示词的修改应该纳入版本控制，便于回溯

## 扩展新功能

如需添加新的 AI 功能（如语法检查、摘要生成等）：

1. 在 `prompts/` 目录下创建新的 `.js` 文件
2. 导出提示词构建函数
3. 在 `index.js` 中添加导出
4. 在 `index.vue` 中导入并使用

示例：

```javascript
// prompts/summarize.js
export const buildSummarizePrompt = (text) => {
  return `请对以下文本进行摘要...`
}

// prompts/index.js
export { buildSummarizePrompt } from './summarize.js'

// index.vue
import { buildSummarizePrompt } from './prompts/index.js'
```
