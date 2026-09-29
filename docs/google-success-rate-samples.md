# Google 翻译成功率对照样本（30 条）

固定、不重复、非敏感的中英短句，供 AC-001 在同一设备、相近时段、冷缓存下对比旧版（A）与新版（B）。

记录时只记「Google 自身是否返回非空译文」（是=1，否=0）。即使其他一级引擎回退成功，该条仍记 Google=0。不要把原文写入日志或 issue。

| # | 文本 | 建议方向 |
| --- | --- | --- |
| 1 | hello world | 英→中 |
| 2 | open source software | 英→中 |
| 3 | request timeout | 英→中 |
| 4 | cache miss | 英→中 |
| 5 | retry later | 英→中 |
| 6 | invalid argument | 英→中 |
| 7 | network unreachable | 英→中 |
| 8 | please try again | 英→中 |
| 9 | file not found | 英→中 |
| 10 | permission denied | 英→中 |
| 11 | 你好世界 | 中→英 |
| 12 | 打开设置 | 中→英 |
| 13 | 复制到剪贴板 | 中→英 |
| 14 | 请求已超时 | 中→英 |
| 15 | 网络不可用 | 中→英 |
| 16 | 请稍后重试 | 中→英 |
| 17 | 保存失败 | 中→英 |
| 18 | 切换引擎 | 中→英 |
| 19 | 清空输入 | 中→英 |
| 20 | 开发者翻译 | 中→英 |
| 21 | array length | 英→中 |
| 22 | hash map | 英→中 |
| 23 | 单元测试 | 中→英 |
| 24 | 故障转移 | 中→英 |
| 25 | dark mode | 英→中 |
| 26 | 深色模式 | 中→英 |
| 27 | keyboard shortcut | 英→中 |
| 28 | 快捷键 | 中→英 |
| 29 | build succeeded | 英→中 |
| 30 | 构建成功 | 中→英 |

## 冷缓存操作

1. 重载对应插件实例（开发形态与 `dist/` 安装形态不是同一实例）。
2. 确认 Google 为 P1，`engineResponseTimeoutSeconds` 为默认 5 秒。
3. 每条样本只翻译一次；不要先用「测试配置」或相同文本预热 24h LRU。
4. 代理列只记「已配置/未配置」，不要写主机或端口。
