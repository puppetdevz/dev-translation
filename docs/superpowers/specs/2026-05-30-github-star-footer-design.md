# 底部 GitHub Star 链接替换快捷键提示

**日期**: 2026-05-30
**状态**: 已批准

## 目标

将底部栏中间的快捷键提示替换为 GitHub Star 求取链接，引导用户为开源项目加星。

## 设计

### 改动范围

仅修改 `src/Translate/index.vue`，删除 `KeyboardShortcuts.vue`。

### 具体变更

1. **模板**: `<KeyboardShortcuts />` → 一个 `<a>` 标签，文案 `⭐ 好用就 Star，不好用提 Issue`
2. **脚本**: 删除 `KeyboardShortcuts` import，新增 `openGitHub` 方法
3. **样式**: 新增 `.github-star-link` 样式，延续现有 footer 风格
4. **清理**: 删除 `src/Translate/components/KeyboardShortcuts.vue`

### 行为

- 点击链接调用 `window.utools.shellOpenExternal()` 打开 GitHub 仓库
- 仓库地址: `https://github.com/puppetdevz/dev-translation`

### 响应式 & 深色模式

- 深色模式通过 CSS 变量自动适配
- 小窗口（<550px 高度）footer 整体隐藏，已存在的规则无需修改
