# 本地词库覆盖率报告

- 生成时间：2026-10-13T09:01:31.110Z
- 单词条目：5000（目标 5000）
- 固定词组条目：500（目标 500）

> 覆盖数量按字段单独统计；只有表头没有任何有效字段的空词条不会被写入词库，因此不计入以上条目数。

| 类别 | 条目数 | 美式 IPA | 中文释义 | 英文释义 | 美式 IPA + 中文释义 | 三项齐全 |
| --- | --- | --- | --- | --- | --- | --- |
| 单词 | 5000 | 4957（99.1%） | 5000（100.0%） | 4402（88.0%） | 4957（99.1%） | 4379（87.6%） |
| 固定词组 | 500 | 500（100.0%） | 220（44.0%） | 498（99.6%） | 220（44.0%） | 218（43.6%） |

## 代表性样本

### parallel（目标样本）

- `parallel` — IPA：/ˈpɛɹəˌɫɛɫ/；中文：adj.平行的；v.並聯；平行；並列；n.平行线；英文：being everywhere equidistant and not intersecting；of or relating to the simultaneous performance of multiple operations；something having the property of being analogous to something else

### 固定词组样本（按交付顺序取前 12 条）

- `get one's knickers in a twist` — IPA：/ˌɡɪt wʌnz ˈnɪ.kɚz ɪn‿ə ˈtwɪst/；中文：v.（因小事而）激动，小题大做；英文：To become overwrought or unnecessarily upset over a trivial matter.
- `come out of the closet` — IPA：/kʌm‿ˌaʊt‿əv ðə ˈklɑzət/；中文：v.出櫃；公開自己過去保密的性取向、少數信仰或偏好；英文：to state openly and publicly one's homosexuality
- `pull out all the stops` — IPA：/ˈpʊl‿aʊt‿ɔl ðə ˈstɑps/；中文：v.毫无保留，全力以赴；英文：use all resources available
- `get down to brass tacks` — IPA：/ɡɛt ˈdaʊn tə bɹæs ˈtæks/；中文：v.开始讨论要点；英文：To (start to) consider or deal with the most important details or facts about something.
- `up to no good` — IPA：/ˌʌp tə ˌnoʊ ˈɡʊd/；中文：做坏事，调皮；英文：Misbehaving, being mischievous.
- `actions speak louder than words` — IPA：/ˈæk.ʃənz spik ˈlaʊ̯d.əɹ ˌðæn wɜɹdz/；中文：事實勝於雄辯；英文：It is more effective to act directly than to speak of action.；An individual's actions indicate their true sentiments more reliably than their claims do.
- `beat around the bush` — IPA：/ˈbit əˌɹaʊ̯nd ðə bʊʃ/；中文：v.旁敲侧击；v.拐弯抹角；英文：be deliberately ambiguous or unclear in order to mislead or withhold information
- `over my dead body` — IPA：/oʊ.vɚ maɪ dɛd bɑ.di/；中文：除非我死了；英文：Under no circumstances; absolutely not.
- `sleep like a log` — IPA：/ˈsliːp laɪk ə ˈlɔɡ/；中文：v.熟睡，沉睡，酣睡；英文：To sleep heavily, long and without disturbance.
- `curiosity killed the cat` — IPA：/ˌkjʊɹ.iˈɑ.sə.ti kɪld ðə ˈkæt/；中文：好奇害死貓；英文：One should not be curious about things that can be dangerous.
- `to a man` — IPA：/tuː‿ə ˈmæn/；中文：一致，沒有例外；英文：without exception
- `cut of one's jib` — IPA：/ˌkʌt‿əv wʌnz ˈd͡ʒɪb/；中文：n.（人的） 外貌，外表，风格；英文：A person's general appearance, manner, or style.

## 选词与排序依据

- 单词：以 Wikipedia enwiki 2023-04-13 词频表降序取常用词，另加入 `scripts/dictionaryDevTerms.json` 中人工整理的开发常用词形清单。
- 固定词组：候选池来自 Open English WordNet 的多词词条（词典词条身份），以各组成词在词频表中的词频之和的对数为常用性代理指标排序；整组美式 IPA 仅采用 en.wiktionary 中带 US/GA/GenAm 等明确地区标注的读音。
- 未标注地区的 IPA、仅英式 IPA 一律不收录，也不由逐词读音拼接词组读音。
- 中英文义项不按数组下标强制对齐；无来源支持时宁缺不造。
