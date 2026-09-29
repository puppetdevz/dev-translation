# AGENTS.md

uTools 插件「开发者翻译」：Vue 3 (Composition API) + Vite 6 + pnpm。插件清单是 `public/plugin.json`。

## 命令

```bash
pnpm dev    # 开发服务器，端口 5175
pnpm test   # 隔离用例（桥接跳过/524/日志脱敏/preload 初始化）
pnpm build  # 构建到 dist/；会把 google-translate-api-x 解引用复制进 dist/preload/node_modules
```

- 无 lint、无 CI。`pnpm test` 不依赖真实外部服务；最终功能仍须在 uTools 内手动验证：插件管理 → 开发者 → 添加开发插件。开发插件选**项目根目录**（走 `public/` + 5175）；核对已安装形态请另选 **`dist/`**，二者不是同一实例。流程见 `TESTING.md` 与 `docs/2026-0929-翻译引擎桥接-实施与验收.md`。
- `plugin.json` 的 `development.main` 必须与 dev 端口一致，改端口要两边同步。

## 架构要点（不看代码容易猜错的部分）

- **所有联网翻译引擎都在 `public/preload/services.js`**（Node 上下文，绕过渲染进程 CORS 限制），通过 `window.services.*` 暴露：`googleTranslate`（三源轮换 + 24h LRU 缓存 + inflight 去重）、`deeplTranslate`、`deeplxTranslate`、`requestThirdpartyAI`、`fetchThirdpartyModels`、`lookupWord`（dictionaryapi.dev 词典）。只有 uTools AI 在渲染进程直接调 `window.utools.ai`。**新增网络请求一律加到 preload，不要在组件里 fetch。** `google-translate-api-x` 为可选源，顶层 `require` 失败不得阻断 `window.services` 赋值。
- preload 是 CommonJS（`public/preload/package.json` 设了 `type: commonjs`，根包是 ESM）——保持 `require()`，勿改成 import。打包产物必须含 `dist/preload/node_modules/google-translate-api-x` 的**真实文件**（禁止残留 pnpm symlink）。
- 引擎调度在 `src/Translate/utils/engineBridge.js`：未配置/缺方法为 `skipped`（不计成功率），真实调用失败才计 `failure`；524 立即回退下一引擎。词典查询失败不得推翻已成功主译文。
- 路由：`src/router.js`（hash 模式），`/` 重定向到 `/translate`，另有 `/settings`。`App.vue` 监听 `utools.onPluginEnter`，用 `action.code` 作为路由名 push。新增功能 = plugin.json 加 feature（code）+ router 加同名路由。
- 引擎故障转移：`src/Translate/index.vue` 按 `settings.failoverOrder` 顺序逐个尝试，**首位是主引擎**。合法引擎标识见 `utils/storage.js` 的 `KNOWN_ENGINES`（ai / thirdparty-ai / google / deepl / deeplx）。
- 设置持久化：单个 dbStorage key `dev-translation-settings`，经 `utils/storage.js` + `utils/useSettings.js`（模块级 reactive 单例，跨组件共享）。`loadSettings` 内含旧配置迁移逻辑（failoverOrder 白名单过滤、deeplMode→deepl/deeplx 拆分），改动需谨慎；新增设置字段只需加 `DEFAULT_SETTINGS`。
- AI 提示词集中在 `src/Translate/prompts/`（中译英 / 英译中 / 润色，index.js 统一导出）。AI 返回的 JSON 需多层容错解析（直接 parse → 提取 markdown 代码块 → 提取花括号）。
- 日志与统计：`utils/logger.js` + `utils/safeLog.js`（最少元数据白名单，读取时清理旧 detail）、`utils/engineStats.js`（成功/失败/跳过；跳过不进 total/recent）。

## 陷阱

- `src/Settings/index.vue`、`src/Translate/components/SettingsPanel.vue`、`KeyboardShortcuts.vue` 是**无引用的遗留文件**，勿当作活代码改。当前设置页是 `Translate/components/SettingsPage.vue`。
- 根目录 `google-translate-endpoints.mjs` 是调研参考实现，不参与构建；运行时 Google 翻译逻辑在 preload。
- `pnpm-workspace.yaml` 仅有 `allowBuilds: esbuild`（允许 esbuild 的安装期构建脚本），勿删。
- 组件里 `<script lang="ts" setup>` 写的实际是纯 JS（仅靠 jsconfig + `utools-api-types` 提供类型提示）。
- `vite.config.js` 的 `base: './'` 是 uTools 加载 `dist/index.html` 的前提，勿改。
- 版本号只维护在根 `package.json`（plugin.json 无 version 字段）；更新日志手写进 `CHANGELOG.md`（中文）。

## UI 约定（改样式前必看）

- 高信息密度优先：合并元素、精简内容（释义≤3、例句≤2）、一屏显示无需滚动。
- 主色调紫色渐变 `#667eea → #764ba2`；统一 `1px` 细边框（浅色 `rgba(226,232,240,…)`，深色 `rgba(51,65,85,…)`）；圆角 10-12px；单层轻阴影（`0 1px 2px` 基础 / `0 2px 4px` 悬停）。
- 所有新样式必须适配深色模式；动画只用 transform 和 opacity。
- 布局：输入/输出区 50/50 分高，CSS Grid 自适应卡片，小窗口（<600px 高）隐藏底部快捷键栏。

## 参考文档

- `README.md` — 功能与使用说明；`CHANGELOG.md` — 版本历史；`TESTING.md` — 手动测试清单
- `docs/superpowers/{plans,specs}/` — 历史设计稿（Google 翻译接入、设置页重构），仅背景参考
