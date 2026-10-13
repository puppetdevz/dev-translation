# 本地词库第三方数据许可与署名

本目录保存随插件分发的词库数据（`shards/`、`manifest.json`）所依据的原始数据许可全文与署名说明。

| 数据源 | 许可 | 许可全文 |
| --- | --- | --- |
| ipa-dict en_US（单词美式 IPA） | MIT | `ipa-dict-MIT.txt` |
| Wikipedia word frequency（选词/排序依据） | MIT | `wikipedia-word-frequency-MIT.txt` |
| Open English WordNet 2025（英文释义/词组候选） | CC BY 4.0 | `open-english-wordnet-CC-BY-4.0.txt` |
| en.wiktionary / zh.wiktionary（词组美式 IPA、中文释义） | CC BY-SA 4.0 | `wiktionary-CC-BY-SA-4.0.txt` |

## 许可边界

- 仓库代码許可为 GPL-3.0-only；第三方词库数据不因放入本仓库而改以 GPL-3.0-only 分发。
- 由 Wiktionary 数据衍生出的词库内容（中文释义、词组美式 IPA、词组英文释义）继续以 CC BY-SA 4.0 相同方式共享，并保留署名与来源链接。
- Open English WordNet 释义以 CC BY 4.0 署名方式使用。
- 运行数据只保留筛选后的词条与字段，不包含原始全量下载库；原始文件的 URL、日期、体积与 SHA-256 见 `SOURCES.json`。
- 复现方式：`node scripts/importDictionary.mjs`（开发阶段执行，不在插件启动或构建时联网）。
