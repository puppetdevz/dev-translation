# 对抗性审查报告

> 审查范围：`origin/main...HEAD` + 工作树未提交改动
> 审查日期：2026-07-05
> 核心文件：`public/preload/services.js`、`src/Translate/index.vue`、`src/Translate/components/SettingsPage.vue`、`src/Translate/utils/storage.js`、`src/Translate/utils/useSettings.js`

## 审查方法

- **Phase 0**：收集 diff 范围（`git diff origin/main...HEAD` + 工作树未提交改动）
- **Phase 1**：5 个 finder 角度并行扫描 — 逐行（A）、删除行为审计（B）、跨文件追踪（C）、语言陷阱（D）、包装器/简化/效率（E）
- **Phase 2**：1-vote 验证（CONFIRMED / PLAUSIBLE / REFUTED）
- **Phase 3**：sweep 查漏补缺
- **最终输出**：15 条最严重 findings，按严重度排序

---

## Findings

### 1. 翻译并发竞态（无请求令牌守卫）

**文件**：`src/Translate/index.vue:339`

**摘要**：`translate()` 无请求令牌守卫，并发调用会竞态——先发出的慢请求后返回时覆盖最新 `translationResult`。

**触发场景**：
```
主引擎 AI 慢（5s）加载期间用户再次点翻译/粘贴新文本触发 enterAction→translate；
两条 await 链路 race 写 translationResult；
handleClear 清空 inputText 后 inflight 旧请求仍回填 translationResult。
先发的慢结果覆盖后发的快结果，UI 显示陈旧译文。
```

**严重度**：🔴 CRITICAL — 核心翻译功能正确性

---

### 2. AI 语言检测竞态

**文件**：`src/Translate/index.vue:61`

**摘要**：`runDetection` AI 分支只 `clearTimeout` 防抖定时器，无法取消已发出但未返回的 `detectLanguageByAI` Promise。连续输入下慢的旧 AI 检测覆盖快的新检测结果。

**触发场景**：
```
detectionStrategy==='ai'，用户连续输入。
第 1 次输入触发 500ms 后发 AI 检测（慢 ~2s）；
500ms 内用户继续输入，新检测 0.3s 返回设置 detectedLanguage=en；
随后第 1 次慢请求返回 zh 覆盖 detectedLanguage。
语言徽章与实际不符，后续翻译 prompt 选错方向。
```

**严重度**：🔴 CRITICAL — 翻译方向选择错误

---

### 3. 输入清空未清除 AI 检测定时器

**文件**：`src/Translate/index.vue:517`

**摘要**：`watch(inputText)` 清空分支重置 `detectedLanguage=''` 但未 `clearTimeout(detectionTimer)`。AI 策略下已 schedule 的 500ms setTimeout 仍会在输入已清空后触发，把 `detectedLanguage` 改回旧检测值。

**触发场景**：
```
detectionStrategy==='ai'，用户输入后立即清空（handleClear 或删除）。
watch 重置 detectedLanguage=''，但未 clearTimeout；
500ms 后 setTimeout 回调 await detectLanguageByAI 仍执行并写入 detectedLanguage。
空输入却显示语言徽章，下次翻译用错方向。
```

**严重度**：🔴 CRITICAL — 状态不一致

---

### 4. 中译英词典查询用错文本

**文件**：`src/Translate/index.vue:204`、`src/Translate/index.vue:260`

**摘要**：zh→en 单词模式用 `translation`（译文，可能是多词英文短语如 "develop software"）去查 `dictionaryapi.dev`（仅收录单词条目），`lookupWord` 返回 `EMPTY_DICT_RESULT`，中译英永远无音标/释义/例句。

**触发场景**：
```
输入 '开发' 经 Google 译文='develop software'；
lookupWord('develop software') 命中 404 → 解析空数组 → phonetic/definitions/examples 全空。
同样问题影响 translateWithDeepL 第 260 行 zh→en 分支。
```

**严重度**：🔴 CRITICAL — 中译英单词模式核心输出功能缺失

---

### 5. Footer 引擎快速切换遗漏第三方 AI

**文件**：`src/Translate/index.vue:469`

**摘要**：`toggleTranslationEngine` 的 `engines=['ai','google','deepl']` 遗漏 `'thirdparty-ai'`。主引擎为第三方 AI 时 `indexOf` 返回 -1，`nextIndex=(-1+1)%3=0` → 永远切到 `'ai'`。

**触发场景**：
```
用户在 SettingsPage 拖拽把第三方 AI 设为主引擎后点底部切换按钮；
直接跳到 'AI' 且后续循环 ai↔google↔deepl 永远回不到第三方 AI；
footer 快捷切换与拖拽设置契约不一致。
```

**严重度**：🟠 HIGH — 功能契约不一致

---

### 6. 未知引擎字符串导致设置页白屏

**文件**：`src/Translate/components/SettingsPage.vue:145`

**摘要**：模板 `v-for` 中 `engineMeta[engine].icon/.name` 直接索引无 `v-if` 防护；`loadSettings` 不对 `failoverOrder` 做白名单过滤，未知引擎字符串导致 `engineMeta[engine]` 为 `undefined` → `TypeError` 白屏。

**触发场景**：
```
dbStorage 残留已废弃引擎标识（如旧版 'youdao'/'azure' 或未来重命名遗留）；
loadSettings 仅补 thirdparty-ai，不剔除未知值；
SettingsPage 渲染 engine-card 时 undefined.icon 抛错，整个设置页白屏。
```

**严重度**：🟠 HIGH — 设置页完全不可用

---

### 7. 第三方 AI 纯文本返回不降级

**文件**：`src/Translate/index.vue:325`

**摘要**：`translateWithThirdpartyAI` 复用 `parseResult`，第三方模型若不按 prompt 返回 JSON 而是纯文本译文，三重回退（`JSON.parse` → ` ```json ` 代码块 → 花括号提取）均失败抛错，不降级为 `{translation: content}`。

**触发场景**：
```
用户配置的第三方模型（部分开源/小参数模型忽略 JSON 指令）返回纯文本 'Hello world'；
parseResult 三路全失败抛 '无法解析翻译结果'；
translate() 捕获后继续 failover，本可展示的有效译文被误判为引擎不可用并静默切换。
```

**严重度**：🟠 HIGH — 可用译文被丢弃

---

### 8. 第三方 AI 错误信息丢失

**文件**：`src/Translate/index.vue:315`

**摘要**：`translateWithThirdpartyAI` 仅取 `data?.choices?.[0]?.message?.content`，未检查 `data.error` 字段。401/429/模型不存在返回 `{error:{message}}` 时 `content=''` → 抛通用错误，丢失真实错误。

**触发场景**：
```
用户填错 API Key 或超额时第三方返回 {error:{message:'Invalid API key'}}；
content='' → 抛 '第三方 AI 返回空结果'；
用户无法区分配额耗尽/key 错误/模型未返回，failover 也继续尝试下一引擎而非提示修复配置。
```

**严重度**：🟠 HIGH — 诊断困难，用户体验差

---

### 9. postJson 不检查 HTTP 状态码

**文件**：`public/preload/services.js:142`

**摘要**：`postJson` 在 `res.on('end')` 只 `JSON.parse` 不检查 `res.statusCode`。4xx/5xx 错误（DeepL 401 key 无效、429 限流、503）只要 body 是合法 JSON 就 resolve 当正常响应。

**触发场景**：
```
DeepL Key 错误返回 403 + {message:'...'}，postJson resolve 该对象；
translateWithDeepL 因 !data.translations 抛 'DeepL 返回空结果' 而非 'Key 无效'；
DeepLX 403 HTML 页面触发 JSON.parse 抛 '响应解析失败'。
错误丢失 HTTP 状态码上下文，诊断困难。
```

**严重度**：🟡 MEDIUM — 错误提示不精确

---

### 10. withTimeout 超时不取消底层网络请求

**文件**：`public/preload/services.js:93`

**摘要**：`withTimeout` 超时仅 reject 外层 Promise，底层 `translate()` 网络请求无取消机制（无 AbortSignal/destroy），socket 仍在飞。

**触发场景**：
```
Google 库慢于 5s 持续超时，每次超时遗留一个仍进行的 google-translate-api-x 请求堆积事件循环；
socket 不释放，高频使用下 fd/连接数泄漏，最终拖垮 preload 进程或触发更严 429 限流。
```

**严重度**：🟡 MEDIUM — 资源泄漏

---

### 11. 缓存无 Inflight 去重

**文件**：`public/preload/services.js:348`

**摘要**：`googleTranslate` 缓存层无 inflight 去重——同一 `(from|to|text)` 并发两次调用都 miss 缓存 → 发起两次完整 `translateWithSources`，绕过缓存降限流意图。

**触发场景**：
```
用户短时间双击翻译或 watch 触发并发同一短语；
缓存未命中 → 两个 Google 库请求同时打到 gtx/clients5；
浪费带宽并触发 Google 端 429 限流，缓存"降低限流概率"的本意被绕过。
```

**严重度**：🟡 MEDIUM — 缓存有效性降低

---

### 12. detectLanguageByAI 无 try/catch

**文件**：`src/Translate/index.vue:51`

**摘要**：`detectLanguageByAI` 无 try/catch，`window.utools.ai` 抛错或返回 undefined 时在 setTimeout 异步回调中产生 unhandled rejection 且 `detectedLanguage` 不更新。

**触发场景**：
```
AI 服务网络异常或用户未配置 AI，detectLanguageByAI 抛错；
detectedLanguage 保持空，翻译时回退 detectLanguage 正则；
控制台报 unhandled rejection，语言徽章长时间不更新且无错误提示。
```

**严重度**：🟡 MEDIUM — 静默失败

---

### 13. handleAcceptPolish 不重置 isManualOverride

**文件**：`src/Translate/index.vue:445`

**摘要**：`handleAcceptPolish` 置换 `inputText` 后用 `detectLanguage` 重算 `detectedLanguage` 但未重置 `isManualOverride`。若采纳前用户曾手动锁定方向，新文本检测被锁死在旧方向。

**触发场景**：
```
用户对 en 原文润色并曾手动锁定 zh 方向（isManualOverride=true）；
采纳润色结果后 inputText 变为新文本，但 isManualOverride 仍 true；
watch(inputText) 不再 runDetection，detectedLanguage 维持锁定的 zh；
后续翻译方向错误。
```

**严重度**：🟡 MEDIUM — 状态残留

---

### 14. loadSettings 静默丢失配置

**文件**：`src/Translate/utils/storage.js:35`

**摘要**：`loadSettings` 用 `if(stored)` 判定，dbStorage 返回 `''` 被当 falsy 走默认值；且 `try` 内 `JSON.parse(stored)` 若 stored 异常抛错被 `catch` 静默回退默认值。用户 DeepL key / failoverOrder 等配置静默丢失。

**触发场景**：
```
dbStorage 因插件迁移返回非字符串或空字符串；
loadSettings 默默返回 DEFAULT_SETTINGS；
用户已配置的 DeepL API Key、第三方 AI 凭证、failoverOrder 顺序全部丢失；
仅控制台 console.error，无 UI 提示。
```

**严重度**：🟡 MEDIUM — 数据丢失无感知

---

### 15. watch(inputText) 无防抖同步计算

**文件**：`src/Translate/index.vue:510`

**摘要**：`watch(inputText)` 每次按键同步调用 `detectInputType(newValue)`，含多次正则（中文匹配 + 中/英标点正则 + split + 长度判断），无防抖。

**触发场景**：
```
长文本逐字符快速输入/粘贴大段时，每次 keydown 都同步执行多正则扫描；
低端机上输入框明显卡顿；
detectInputType 仅 translate 时真正消费，watch 中提前计算属浪费。
```

**严重度**：🔵 LOW — 性能问题

---

## 缺陷分类汇总

### 🔴 CRITICAL（建议优先修复）

| # | 文件 | 行号 | 摘要 |
|---|------|------|------|
| 1 | `index.vue` | 339 | 翻译并发竞态（无请求令牌守卫） |
| 2 | `index.vue` | 61 | AI 检测竞态，慢旧请求覆盖快新结果 |
| 3 | `index.vue` | 517 | 输入清空未 clearTimeout 检测定时器 |
| 4 | `index.vue` | 204 | 中译英词典查询用译文（多词短语）查单词条目 API |

### 🟠 HIGH

| # | 文件 | 行号 | 摘要 |
|---|------|------|------|
| 5 | `index.vue` | 469 | Footer 切换遗漏 thirdparty-ai |
| 6 | `SettingsPage.vue` | 145 | 未知引擎字符串白屏 |
| 7 | `index.vue` | 325 | 第三方 AI 纯文本不降级 |
| 8 | `index.vue` | 315 | 第三方 AI 错误信息丢失 |

### 🟡 MEDIUM

| # | 文件 | 行号 | 摘要 |
|---|------|------|------|
| 9 | `services.js` | 142 | postJson 不检查 HTTP 状态码 |
| 10 | `services.js` | 93 | withTimeout 不取消底层请求（资源泄漏） |
| 11 | `services.js` | 348 | 缓存无 inflight 去重 |
| 12 | `index.vue` | 51 | detectLanguageByAI 无 try/catch |
| 13 | `index.vue` | 445 | handleAcceptPolish 不重置 isManualOverride |
| 14 | `storage.js` | 35 | loadSettings 静默丢失配置 |

### 🔵 LOW

| # | 文件 | 行号 | 摘要 |
|---|------|------|------|
| 15 | `index.vue` | 510 | watch(inputText) 无防抖同步计算 |

---

## 测试用例

```javascript
// 1. 翻译并发竞态
// 操作：主引擎 AI 模拟慢响应；输入文本点翻译→立即清空→粘贴新文本再点翻译
// 期望：translationResult 最终为新文本结果，不被旧慢请求覆盖
// 当前：旧慢请求后返回覆盖新结果（REPRO）

// 2. AI 检测竞态
// 操作：detectionStrategy='ai'，连续输入 'hello'→'hello world'（300ms 内）
// 期望：detectedLanguage 最终为 en
// 当前：若第一次 AI 检测慢，可能被旧结果覆盖（REPRO）

// 3. 输入清空后语言徽章残留
// 操作：detectionStrategy='ai'，输入 '你好'→500ms 内清空
// 期望：detectedLanguage=''，徽章消失
// 当前：500ms 后定时器仍触发，detectedLanguage 被设回 zh（REPRO）

// 4. 中译英词典查询
// 操作：主引擎 Google，输入 '开发'，输出
// 期望：translation + phonetic + definitions + examples
// 当前：translation='develop software'，lookupWord 多词返回空，phonetic/definitions/examples 全空（REPRO）

// 5. Footer 切换不可达第三方 AI
// 操作：拖拽 thirdparty-ai 至主引擎，回主界面点切换按钮
// 期望：循环 ai→google→deepl→thirdparty-ai→ai
// 当前：直接跳 ai，thirdparty-ai 不可达（REPRO）

// 6. 未知引擎白屏
// 操作：手动改 dbStorage failoverOrder=['youdao','ai']，打开 SettingsPage
// 期望：友好降级或过滤未知值
// 当前：engineMeta['youdao'] undefined → TypeError 白屏（REPRO）

// 7. 第三方 AI 返回纯文本
// 操作：配置返回非 JSON 纯文本的第三方模型
// 期望：展示译文
// 当前：抛错 failover（REPRO）

// 8. DeepL Key 错误
// 操作：填错 DeepL Key 翻译
// 期望：提示 'Key 无效' 或含状态码
// 当前：提示 'DeepL 返回空结果'/'响应解析失败'（REPRO）

// 9. 双击翻译缓存击穿
// 操作：缓存 miss 状态下双击翻译同一短语
// 期望：一次实际请求
// 当前：两次并发请求（REPRO）

// 10. dbStorage 返回 '' 配置丢失
// 操作：模拟 dbStorage.getItem 返回 ''
// 期望：提示配置读取失败
// 当前：静默回退默认值，配置丢失（REPRO）
```

---

## 建议修复顺序

1. **`index.vue:339`** — 引入请求令牌（requestId）守卫，过期请求忽略结果
2. **`index.vue:61/517`** — AI 检测加版本号 + watch 清空分支 clearTimeout(detectionTimer)
3. **`index.vue:204`** — zh→en 单词模式对多词译文跳过 lookupWord，而非返回全空字典结果
4. **`index.vue:469`** — engines 数组补全 4 引擎（ai、thirdparty-ai、google、deepl）
5. **`SettingsPage.vue:145`** — loadSettings 对 failoverOrder 做白名单过滤 + 模板加 `engineMeta[engine] &&` 防护
6. **`index.vue:325/315`** — parseResult 纯文本降级为 `{translation: content}`；检查 `data.error` 提取真实错误信息
7. **`services.js:142`** — postJson 加 `res.statusCode >= 400` 检查并抛含状态码的错误
8. **`services.js:93`** — withTimeout 传入 AbortSignal 或接受取消能力
9. **`services.js:348`** — 缓存层共享 pending Promise（inflight 去重）
10. 其余 MEDIUM/LOW 项按优先级排队修复
