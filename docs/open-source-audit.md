# 开源准备审计

## 范围与结论

审计与整改复验日期：2026-09-30；初始代码基线：`550dee7`；用户已复核并授权本次整改的本地提交，提交记录以 Git 日志为准。本报告是技术检查，不是法律意见或无漏洞保证。

**结论：必要源码/依赖/许可整改及本地历史隐私清理已通过复验，但远程旧历史尚未净化，仍不满足公开要求。** 本地作者/提交者已统一为 `zhongyuming <puppetdevz@gmail.com>`，旧私人邮箱及已确认的历史本机路径已清理；远程备份未修改。用户最初仅授权方案，随后明确授权在当前仓库直接重写、不使用独立副本、不得推送。uTools 宿主分发许可边界及真实宿主验收仍未作最终认定。

「GPL 许可」与「敏感信息」是核心维度，但还需增加依赖/资源授权、应用安全、隐私及外部服务合规、构建与分发、社区维护。

用户确认采用 GPL-3.0-only、署名 zhongyuming，并确认代码/素材授权；随后授权必要整改。已修改源码、依赖锁文件和相关文档，并新增许可/版权声明与安全/分发回归测试。未修改版本号（仍为 1.5.0）或 CHANGELOG；后续已按明确授权重写本地提交并更新本地标签指向，未修改远程仓库，未推送或发布。运行构建重新生成被忽略的 `dist/`。

| 维度 | 结果 | 优先级 |
| --- | --- | --- |
| GPL-3.0 落地 | LICENSE、NOTICE、package.json 与 README 已明确 GPL-3.0-only / zhongyuming | 已整改 |
| 源码与 Git 秘密 | 未发现真实凭据；本地身份/历史路径已清理，远程旧历史未更新 | 本地完成，远程待授权 |
| 第三方分发许可 | dist 自动保留项目许可/版权及实际分发组件完整许可文本 | 已整改 |
| 应用安全 | 去除例句 v-html，改为安全文本节点；4 个安全 SSR 回归通过 | 已整改，宿主待验 |
| 依赖安全 | 初始 7 high / 3 moderate，兼容更新后 audit 各等级均 0，peers 无冲突 | 本次审计通过 |
| 构建 | 工作区/干净副本 168 个测试通过，30 个产物文件哈希一致 | 本机验证通过 |
| 隐私与服务边界 | README / SECURITY.md 已披露明文存储、HTTP 和外部数据流 | 已补文档，机制未改变 |
| 社区与防回归 | 新增 SECURITY.md 与忽略规则；CI/贡献指南/私密报告入口/版本固定仍待维护者配置 | 后续建议 |

## 1. GPL 与版权

初始根目录没有 LICENSE，`package.json` 没有 `license` 字段，README 没有项目许可说明。整改已添加标准 GPL 正文与 NOTICE，并明确 GPL-3.0-only、Copyright (C) 2026 zhongyuming。两个标识的区别为：

- `GPL-3.0-only`：只允许按 GPL 第 3 版使用。
- `GPL-3.0-or-later`：同时允许使用后续 GPL 版本。

二者使用相同 GPLv3 正文，但项目的授权声明不同；须由版权方决定，不能通过许可证正文末尾的示例占位符代替正式声明。

落地建议：添加标准 LICENSE 正文；在 package.json、README 中写明准确 SPDX 标识和适用范围；使用已确认的公开版权署名，不自动引入私人邮箱；打包时把项目许可与第三方版权/许可文本一并放入 dist。分发二进制或压缩插件时，提供与该产物对应的完整源码及构建脚本/锁文件，不能仅给一个随时变化的主分支链接。

GPL 可以允许商业使用和再分发；不能额外加“禁止商用”等冲突限制。给自己的代码选择 GPL，不会把第三方代码、商标或外部服务自动变为 GPL。

### 依赖

初始依据 `pnpm licenses list --json` 和本机依赖的 LICENSE 文件，已安装依赖共 72 个名称、78 个版本项：MIT 74、BSD-2-Clause 1、ISC 2、BSD-3-Clause 1。兼容更新后为 72 个名称、79 个版本项：MIT 75、BSD-2-Clause 1、ISC 2、BSD-3-Clause 1。声明层面未发现与 GPLv3 明显不兼容的许可。该统计不代表未安装的其他平台可选二进制全部经过人工审阅，也不等于全部包内部资源均已清查。

直接依赖均声明 MIT：

| 包 | 初始安装版本 |
| --- | --- |
| google-translate-api-x | 10.7.3 |
| vue | 3.5.26 |
| vue-router | 5.0.7 |
| @vitejs/plugin-vue | 5.2.4 |
| utools-api-types | 6.1.0 |
| vite | 6.4.3 |

初始构建产物只有 `dist/preload/node_modules/google-translate-api-x/LICENSE`，缺少项目 GPL 正文及前端依赖完整许可文本。整改通过 `scripts/distributionLicenses.mjs` 在构建时生成 `dist/LICENSE`、`dist/NOTICE`、`dist/THIRD_PARTY_NOTICES.txt`；项目文本原样保留，后者保留 6 个实际分发组件（Vue runtime-core/runtime-dom/reactivity/shared、vue-router、google-translate-api-x）的原始版权/许可文本，不包含开发机绝对路径。缺少第三方许可文本时构建失败，3 个分发许可测试通过。

### 版权确认与宿主边界

- 用户已确认代码、提示词、logo 和截图等内容的开源/再分发权，版权署名 zhongyuming；这是版权方确认，未作独立法律核验。
- 历史 `documents/image.png` 显示另一个翻译插件界面；不包含可见秘密，但其中第三方权利不因本项目采用 GPL 自动改变。
- 插件与 uTools 专有宿主的结合属于需要单独确认的许可边界。`utools-api-types` 的 MIT 许可不能替代宿主许可；是否需额外许可例外应结合插件耦合和宿主条款判断，不能直接断言兼容或不兼容，也不能未经版权方同意添加例外。

参考：

- GPLv3 正文：https://www.gnu.org/licenses/gpl-3.0.html
- 下载正文的 SPDX 官方数据源：https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-only.txt
- SPDX 标识：https://spdx.org/licenses/GPL-3.0-only.html 、https://spdx.org/licenses/GPL-3.0-or-later.html
- GNU 插件许可讨论：https://www.gnu.org/licenses/gpl-faq.html#GPLPlugins
- 本机依赖：`node_modules/{vue,vue-router,google-translate-api-x}/LICENSE`

GNU/SPDX 网站正文读取受到本机网络工具的 fake-IP 防护限制；已从 SPDX 官方 GitHub 数据源获取 GPL 正文。宿主法律兼容性未作最终认定。

## 2. 敏感信息与 Git 历史

### 已执行的检查

使用 Gitleaks 8.30.1（官方发行下载，SHA-256 与官方校验文件比对通过），使用默认规则、不启用忽略基线、不采纳 `gitleaks:allow` 注释，并对输出完全脱敏。

1. `gitleaks git` 扫描 `--all --reflog --full-history` 的历史差异：0 命中。工具输出 113 个被扫描提交；因此另外执行了完整对象检查，不能把 113 误当完整提交总数。
2. `git cat-file --batch-all-objects` 枚举所有本地对象：125 commit、344 blob、376 tree，共 845 个对象。将每个非二进制 blob、commit/tag 文本交由 Gitleaks 再扫描：0 命中。这避免合并提交、删除内容、reflog 或不可达对象仅靠 diff 扫描遗漏。
3. 普通工作区 Gitleaks 扫描：0 命中。
4. 另行枚举包括 ignored dist 在内的第一方工作区文本，排除 `.git`、`.codegraph`、`node_modules` 后扫描：0 命中。整改后普通工作区、含 dist 的第一方文本及全部 Git 对象文本再次扫描，均为 0 命中。
5. 补充检查凭据字面量、Authorization、含认证信息的 URL、私钥标记、个人路径、内网 IP、历史敏感文件名；命中的凭据相关值人工核对为测试假数据或 UI 类型字符串。没有对候选凭据进行联网有效性验证。
6. 人工查看全部 9 个历史/当前 PNG blob，未发现可见密钥或私人配置；检查了 PNG 文本/Exif 元数据入口。
7. 仓库不是浅克隆。检查全部本地 refs、reflog；远程 `git ls-remote --heads --tags origin` 返回 main 和 v1.1.0–v1.4.0，其 tip 对象均在本地。远程 URL 未嵌入用户名/密码，本地配置未发现认证 extraheader/token/password 字段。

本次检查覆盖本地可获得的完整对象和远程公布的分支/标签，但不覆盖远程已删除对象、隐藏 PR refs、服务端缓存、fork、旧克隆、Issues/附件、Actions 日志、Release 附件或本机 uTools 数据库。规则扫描也无法证明任意字符串绝不可能是秘密。

### 初始个人信息发现与当前状态

- Git 作者/提交者元数据保留 2 个个人邮箱（不同署名共用其中一个）；这不等于密钥泄露。用户现已允许 `puppetdevz@gmail.com` 公开，并将公开姓名统一为 `zhongyuming`；初始历史中的另一旧邮箱及不符合目标的作者/提交者身份现已在本地定向处理，远程旧历史尚未更新。
- 历史 TESTING.md blob `27e498b7…` 第 21 行有个人本机绝对路径。相关历史提交包括 `067e3db`、`64a4467`；当前版本在清理前已删除该路径；后续本地历史已精确替换，远程备份仍保留旧内容。
- 删除当前文件或新增 .gitignore **不能清理已经存在的历史**。若要隐藏邮箱/历史路径，需单独授权历史重写，并覆盖所有相关分支和标签；已经被他人复制的内容不能靠重写追回。

本次按明确的个人信息隐私要求执行定向重写，并非仅为“保险”盲目改写历史。若后续确认某个值确为真实凭据，应先撤销/轮换，再处理历史。

防回归建议：忽略 `.env`、本地认证配置、临时审计文件；显式保留无真实秘密的 `.env.example`；在 CI/提交前加入 Gitleaks。不要笼统忽略所有 LICENSE 或测试数据，不要将整个测试目录排除扫描。

审计原始材料和两个安全复现测试存放于仓库外 `/tmp/dev-translation-audit.*`，没有把历史文本或秘密扫描原始报告提交到项目中。

### 本地历史清理复验

执行前远程 main 已包含开源整改提交 `1c84ba3`，且全部 4 个发布标签与本地一致。按后续授权在当前仓库执行 full rewrite：126 个提交全部保留，125 个哈希改变；逐提交核对说明、日期、父图与完整文件清单，只有目标身份及精确路径替换发生变化，第三方版权不变。

净化后全部本地对象为 126 commit、360 blob、382 tree，旧私人邮箱和路径匹配数为 0；Gitleaks 全对象文本及历史/reflog 扫描均为 0，Git fsck 通过。再次执行 test 168/168、build、audit 全等级 0、peers 检查通过。后续实施记录提交为新增文档提交，不计入重写基线的 126 个提交。

远程分支/标签在操作前后完全一致，未 push；origin 配置已恢复，但没有 fetch 或恢复指向旧历史的远程跟踪引用。远程备份仍含旧个人信息，不能因此直接公开；未来不得未经授权 fetch/pull 引入旧历史或强推。详细映射及注意事项见 [实施记录](./git-history-privacy-plan.md)。

## 3. 新发现的应用安全问题

初始位置：`src/Translate/components/WordResult.vue:66–71` 与 `:124`。以下描述为基线发现，已整改。

`highlightKeyword` 只做关键词的正则转义，没有做 HTML 转义；返回值直接传给 `v-html`。例句来自 AI/词典等外部内容，不能默认可信。形如带事件属性的 img 标签会完整保留；空关键词分支也会原样返回。

已在仓库外编写 2 个隔离复现测试：

- 非空关键词时，恶意 HTML 应被作为文本显示：失败。
- 空关键词时，也应转义 HTML：失败。

因此确认不可信 HTML 可到达 DOM HTML 渲染入口。尚未在真实 uTools 中执行浏览器攻击演示，不能把静态复现等同于已验证的密钥窃取或 Node 执行。鉴于页面可访问 `window.services`、`window.utools` 和明文设置，此入口应优先修复。

已整改：先增加 `scripts/word-result-security.test.mjs`，在旧实现上复现失败；随后把例句拆为文本片段，用 Vue 文本节点和受控 mark 节点高亮，移除外部 HTML 渲染入口。4 个真实组件 SSR 回归覆盖非空/空关键词、恶意关键词及正则元字符，全部通过。尚需真实 uTools 验收，未执行实际攻击。

## 4. 依赖安全公告

初始 `pnpm audit --json`：7 high、3 moderate，共 10 条公告，涉及 rollup、picomatch、postcss、nanoid。

初始 `pnpm audit --prod --json`：6 high、3 moderate，涉及 picomatch、postcss、nanoid；主要路径来自 vue/vue-router 的编译或工具相关依赖。`--prod` 是依赖图分类，不代表这些有漏洞的功能一定包含或可触发于最终插件。

示例公告与修复版本：

| 包 | 初始安装版本 | 公告所需修复版本（合并各条要求） | 官方公告例子 |
| --- | --- | --- | --- |
| rollup | 4.55.1 | >=4.59.0 | https://github.com/advisories/GHSA-mw96-cpmx-2vgc |
| picomatch | 4.0.3 | >=4.0.4 | https://github.com/advisories/GHSA-c2c7-rcm5-vvqj |
| postcss | 8.5.6 | >=8.5.23 | https://github.com/advisories/GHSA-fxqj-rqcc-2cmp |
| nanoid | 3.3.11 | >=3.3.18 | https://github.com/advisories/GHSA-2v37-7h3g-55p8 |

上述初始信息来自 npm registry 审计响应，不是已验证的本项目实际利用结论。已更新锁文件与兼容范围：Vue 3.5.43、rollup 4.63.5、postcss 8.5.28、picomatch 4.0.7、nanoid 3.3.19；Vite 保持 6.4.3，vue-router 保持 5.0.7，并收窄为 ~5.0.7，以避免 5.1+ 要求 Vite 7/8 的 peer 冲突。没有跨框架主要版本升级或 overrides。最终 audit 全等级均 0，peers 无冲突，test/build 通过。

## 5. 隐私、服务与公开说明

- API 凭据通过 uTools dbStorage 明文保存，README 已说明；应增加清晰的 SECURITY/隐私说明，不应宣称“加密”或“安全保险箱”。
- 自定义 AI/DeepLX 支持 HTTP；远程 HTTP 会明文传送原文及凭据。可以保留 localhost 自部署场景，对远程明文连接应给出警告或限制。
- 故障转移可能将同一文本依次发送给多个配置引擎；词典补充会发送英文单词；AI 检测/润色也需要服务处理。应明确这些数据流及用户配置责任，不将“开源”等同于“完全离线”。
- Google 使用非官方/免费翻译来源；源代码包的 MIT 许可不等于 Google 服务使用授权，需说明非官方、无 SLA、可能限流，以及遵守服务条款。其他引擎收费/服务条款同样不受项目 GPL 替代。
- 系统语音是否使用在线声音取决于运行环境，不应未经运行验证承诺发音全部离线。
- 建议提供非公开漏洞报告途径，避免在公开 Issue 中贴真实 key、原文、设置或数据库备份。

## 6. 构建、分发及维护

已验证：

- 初始工作区及 git archive 干净副本：正常测试 161/161 通过，但另行新增的 2 个安全复现失败；这些原有用例未覆盖 HTML 注入。
- 整改工作区：测试 168/168 通过（新增 4 个安全回归与 3 个许可测试），build 通过；SSR 测试关闭时的依赖扫描噪声也已消除。
- 复制全部待提交的源码与新文件到仓库外干净目录（不是只导出旧 HEAD）：`pnpm install --offline --frozen-lockfile` 成功，test 168/168 通过，build 通过。
- 本机 Node v26.7.0、pnpm 12.6.0；整改干净构建与工作区的 30 个产物文件 SHA-256 一致。
- dist 全部无符号链接，项目 LICENSE/NOTICE 与根文件逐字节一致；preload 依赖真实目录与自身 LICENSE 保留。

限制：离线安装复用了本机 pnpm store；未在无缓存联网的新机器、其他 OS/Node 版本或真实 uTools 宿主中验证。源码安全回归和 registry 审计通过不构成绝对安全保证。

已在 README 增加测试命令、许可/源码分发说明和本机验证版本，并新增 SECURITY.md。后续建议固定受支持 Node/pnpm 版本；CI 执行 frozen install、test、build、依赖/秘密检查；补充 CONTRIBUTING.md 和问题模板。CI、社区文件不是选择 GPL 的法律前提，但能降低开源后维护和误泄露成本。

GitHub 匿名仓库 API 本次返回 404，不能据此区分私有、不存在或受限，更不能宣称远程已公开或秘密保护已启用。公开前需由维护者核对可见性、协作权限、分支保护、可用的秘密扫描和既有 Release/附件。

## 用户决策与尚待处理

已确认：GPL-3.0-only、版权署名 zhongyuming、代码/素材授权，以及实施许可证与必要整改。Git 作者/提交者的公开身份为 `zhongyuming <puppetdevz@gmail.com>`；其他旧邮箱和本机路径不公开。第三方版权保留不变。用户已复核整改并授权本地提交，随后又明确授权在当前仓库直接执行本地历史隐私清理，要求不推送。

- 本地清理已完成，完整映射及注意事项见 [git-history-privacy-plan.md](./git-history-privacy-plan.md)。远程更新仍需另行授权，远程备份及服务端其他副本尚未净化。
- uTools 宿主结合的许可边界、安装包与对应源码交付、真实宿主验收需要维护者继续确认。
- CI/贡献指南/私密漏洞报告入口/托管平台保护配置等未纳入本次必要整改。
- 未授权推送或发布。版本发布、版本号和 CHANGELOG 更新只能在用户另行触发发布流程后进行。
