/**
 * 词库导入用的纯文本解析工具（开发阶段脚本，不进入插件运行时）。
 *
 * 解析对象是 Wiktionary 的维基文本：
 * - zh.wiktionary：英语词条的中文释义（含词性模板/章节）
 * - en.wiktionary：英语词条的英文释义与带地区标注的美式 IPA
 *
 * 解析只在开发阶段使用；运行时词库是这里输出的精简 JSON。
 */

const ZH_POS_BY_NAME = new Map(Object.entries({
  '名詞': 'n.', '名词': 'n.',
  '動詞': 'v.', '动词': 'v.',
  '形容詞': 'adj.', '形容词': 'adj.',
  '副詞': 'adv.', '副词': 'adv.',
  '介詞': 'prep.', '介词': 'prep.', '介係詞': 'prep.', '介系词': 'prep.',
  '連詞': 'conj.', '连词': 'conj.',
  '代詞': 'pron.', '代词': 'pron.',
  '數詞': 'num.', '数词': 'num.',
  '冠詞': 'art.', '冠词': 'art.',
  '感嘆詞': 'int.', '感叹词': 'int.', '感歎詞': 'int.',
  '助詞': 'part.', '助词': 'part.',
  '助動詞': 'aux.', '助动词': 'aux.',
  '短語': 'phr.', '短语': 'phr.', '片語': 'phr.',
  '縮寫': 'abbr.', '缩写': 'abbr.',
  '專有名詞': 'prop.', '专有名词': 'prop.',
  '前綴': 'prefix', '前缀': 'prefix',
  '後綴': 'suffix', '后缀': 'suffix',
  '詞根': 'root', '词根': 'root',
  '量詞': 'class.', '量词': 'class.',
  '限定詞': 'det.', '限定词': 'det.',
  '代名詞': 'pron.', '代名词': 'pron.',
  '形容動詞': 'adj.', '形容动词': 'adj.',
  '分詞': 'part.', '分词': 'part.',
  '標點符號': 'punct.', '标点符号': 'punct.',
  '字母': 'letter',
  '符號': 'symbol', '符号': 'symbol',
}))

const ZH_POS_BY_TEMPLATE = new Map(Object.entries({
  '-n-': 'n.',
  '-noun-': 'n.',
  '-name-': 'prop.',
  '-prop-': 'prop.',
  '-proper noun-': 'prop.',
  '-v-': 'v.',
  '-verb-': 'v.',
  '-a-': 'adj.',
  '-adj-': 'adj.',
  '-adjective-': 'adj.',
  '-adv-': 'adv.',
  '-adverb-': 'adv.',
  '-prep-': 'prep.',
  '-preposition-': 'prep.',
  '-conj-': 'conj.',
  '-conjunction-': 'conj.',
  '-pron-': 'pron.',
  '-pronoun-': 'pron.',
  '-num-': 'num.',
  '-number-': 'num.',
  '-art-': 'art.',
  '-article-': 'art.',
  '-int-': 'int.',
  '-interj-': 'int.',
  '-part-': 'part.',
  '-particle-': 'part.',
  '-aux-': 'aux.',
  '-phrase-': 'phr.',
  '-phr-': 'phr.',
  '-abbr-': 'abbr.',
  '-prefix-': 'prefix',
  '-pref-': 'prefix',
  '-suffix-': 'suffix',
  '-suf-': 'suffix',
  '-root-': 'root',
  '-class-': 'class.',
  '-det-': 'det.',
  '-determiner-': 'det.',
  '-punct-': 'punct.',
  '-letter-': 'letter',
  '-symbol-': 'symbol',
}))

/** 非词性的三级/四级章节名：其中的列表行不是释义。 */
const NON_POS_SECTIONS = new Set([
  '發音', '发音', '讀音', '读音', '音頻', '音频',
  '詞源', '词源', '語源', '语源', '詞源學', '词源学',
  '參見', '参见', '相關詞', '相关词', '相關詞彙', '同義詞', '同义词', '同義字',
  '反義詞', '反义词', '反義字', '派生詞', '派生词', '衍生詞', '衍生词',
  '翻譯', '翻译', '變格', '变格', '變位', '变位', '詞形變化', '词形变化',
  '用法說明', '用法说明', '使用注意', '註釋', '注释', '註解', '注解',
  '參考', '参考', '參考文獻', '参考文献', '外部連結', '外部链接', '延伸閱讀', '延伸阅读',
  '目錄', '目录', '其他寫法', '其他写法', '替代形式', '另見', '另见', '變體', '变体',
  '詞組', '词组', '搭配', '慣用語', '惯用语', '用法', '例句', '示例',
  'Translations', 'Translation', 'Usage notes', 'Synonyms', 'Antonyms', 'See also',
  'References', 'Further reading', 'Anagrams', 'Derived terms', 'Related terms',
  'Alternative forms', 'Etymology', 'Pronunciation', 'Descendants', 'Quotations',
])

const EN_POS_BY_NAME = new Map(Object.entries({
  'Noun': 'n.', 'Proper noun': 'prop.', 'Verb': 'v.', 'Adjective': 'adj.', 'Adverb': 'adv.',
  'Preposition': 'prep.', 'Conjunction': 'conj.', 'Pronoun': 'pron.', 'Numeral': 'num.',
  'Article': 'art.', 'Interjection': 'int.', 'Particle': 'part.', 'Phrase': 'phr.',
  'Prepositional phrase': 'phr.', 'Adverbial phrase': 'phr.', 'Noun phrase': 'phr.',
  'Verb phrase': 'phr.', 'Proverb': 'phr.', 'Contraction': 'contr.', 'Determiner': 'det.',
  'Auxiliary verb': 'aux.', 'Abbreviation': 'abbr.', 'Initialism': 'abbr.', 'Acronym': 'abbr.',
  'Symbol': 'symbol', 'Letter': 'letter', 'Prefix': 'prefix', 'Suffix': 'suffix',
  'Postposition': 'postp.', 'Circumposition': 'circum.', 'Coordinating conjunction': 'conj.',
  'Subordinating conjunction': 'conj.', 'Idiom': 'phr.',
}))

const ENGLISH_SECTION_NAMES = ['English', '英语', '英語']

function findSectionRange(text, names) {
  const lines = String(text || '').split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(={2,4})\s*([^=\n]+?)\s*\1\s*$/.exec(lines[i])
    if (!m) continue
    const title = m[2].trim()
    if (start === -1) {
      if (names.includes(title)) {
        start = i + 1
        level = m[1].length
      }
      continue
    }
    if (m[1].length <= level) {
      return { start, end: i }
    }
  }
  return start === -1 ? null : { start, end: lines.length }
}

/** 清理维基文本：链接、模板、注释、引用、粗斜体等。 */
export function cleanWikiText(raw) {
  let s = String(raw == null ? '' : raw)
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<ref[^>]*\/>/gi, '')
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  // [[目标|显示]] / [[目标]]
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\[\[([^[\]|]*)\|([^[\]|]*)\]\]/g, '$2').replace(/\[\[([^[\]|]+)\]\]/g, '$1')
    if (next === s) break
    s = next
  }
  // {{l|zh|词}} / {{zh-l|词}} / {{t|zh|词}} 等取最后一个非语言码参数
  s = s.replace(/\{\{\s*(?:l|m|zh-l|link|t|tt|t\+|taxlink|w|wikipedia)\s*\|([^{}]*)\}\}/gi, (whole, params) => {
    const parts = String(params).split('|').map(p => p.trim()).filter(Boolean)
    const tail = parts[parts.length - 1] || ''
    return tail
  })
  // 其余模板整体去掉；先处理嵌套
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\{\{[^{}]*\}\}/g, ' ')
    if (next === s) break
    s = next
  }
  s = s.replace(/\{\{[^{}]*$/g, ' ')
  s = s.replace(/'{2,5}/g, '')
  s = s.replace(/<[^>]{0,120}>/g, ' ')
  s = s.replace(/\}\}/g, ' ')
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&times;/gi, '×').replace(/&[a-z]+;|&#\d+;/gi, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const CJK_RE = /[\u3400-\u9fff]/
const EN_DEF_TEXT_RE = /[A-Za-z]/

// 词源/用法说明类整行文本：不是释义，避免占用释义条目
const ETYMOLOGY_LIKE = /(源自|來自|来自|源于|源於|源出|出自|借自|借入|借詞|借词|同源|語源|语源|早期形式|縮略|缩略|音變自|音变自|翻譯自|翻译自|首次記錄|首次记录|常寫作|常写作|拼寫形式|拼写形式|的另一種寫法|的另一种写法|参见|參見|另見|另见)/

function isUsableChineseDefinition(text) {
  if (!text || text.length > 60) return false
  if (!CJK_RE.test(text)) return false
  // 残留模板/链接/标签、维基分类行、空括号均不是释义
  if (/[{}\[\]]/.test(text)) return false
  if (/(?:Category|category|分类|分類)\s*:/.test(text)) return false
  if (/\(\s*\)|（\s*）/.test(text)) return false
  // 未解析的模板参数残留（如 t=…、pos=…、noshow=1），或词源/用法说明整行
  if (/\b[a-z]{1,7}=/.test(text)) return false
  if (ETYMOLOGY_LIKE.test(text)) return false
  // 模板被剔除后留下的残缺句尾（如「可能是 。」）
  if (/[\s，、；：]\s*[。．]\s*$/.test(text)) return false
  // 纯标签/模板残留
  if (/^[（(【]?\s*(?:中文|英語|英语|漢語|汉语)\s*[)）】]?$/.test(text)) return false
  return true
}

/** 从 `* {{zh}}：词1, 词2` 形式的翻译行中取出中文部分。 */
function chineseFromTranslationBullet(line) {
  const m = /^\*\s*\{\{\s*(zh|中文|漢語|汉语|cmn)\s*\}\}\s*[:：]?\s*(.*)$/i.exec(line)
  if (!m) return ''
  return m[2].trim()
}

/** `* -{[[正體]]: '''工作'''[電子計算機]}-` 形式的术语表行。 */
function chineseFromGlossaryLine(line) {
  const m = /-\{[^{}]{0,80}'''(.+?)'''[^{}]{0,80}\}-/.exec(line)
  if (!m) return ''
  return m[1]
}

function isUsableEnglishDefinition(text) {
  if (!text || text.length < 2 || text.length > 120) return false
  if (!EN_DEF_TEXT_RE.test(text)) return false
  return true
}

function pushUnique(list, item, max) {
  if (list.length >= max) return
  const key = item.pos + '\u0000' + item.meaning
  if (list.some(x => x.pos === item.pos && x.meaning === item.meaning)) return
  if (list.some(x => x.meaning === item.meaning)) return
  list.push(item)
}

/**
 * 抽取 zh.wiktionary 英语词条的中文释义。
 * @returns {{pos: string, meaning: string}[]}
 */
export function extractChineseDefinitions(wikitext) {
  const range = findSectionRange(wikitext, ENGLISH_SECTION_NAMES)
  if (!range) return []
  const lines = String(wikitext).split('\n').slice(range.start, range.end)
  // primary：词性章节内的 #/* 行释义；secondary：无章节标题时的裸行释义（词源/用法说明已剔除）
  const primary = []
  const secondary = []
  let pos = ''
  let sawPosSection = false
  let skip = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const templateMarker = /^\{\{(-[a-z ._-]+-)\}\}\s*$/i.exec(line)
    if (templateMarker) {
      const key = templateMarker[1].toLowerCase()
      const mapped = ZH_POS_BY_TEMPLATE.get(key) || ZH_POS_BY_TEMPLATE.get(key.replace(/^-/, '-').replace(/--$/, '-'))
      if (mapped) {
        pos = mapped
        sawPosSection = true
        skip = false
        continue
      }
      if (key === '-a-' || key === '-adj-') {
        pos = 'adj.'
        sawPosSection = true
        skip = false
        continue
      }
    }

    const header = /^(={3,4})\s*([^=\n]+?)\s*\1\s*$/.exec(line)
    if (header) {
      const title = header[2].trim()
      const zhPos = ZH_POS_BY_NAME.get(title)
      const enPos = EN_POS_BY_NAME.get(title)
      if (zhPos || enPos) {
        pos = zhPos || enPos
        sawPosSection = true
        skip = false
      } else if (NON_POS_SECTIONS.has(title)) {
        skip = true
      }
      continue
    }

    // 词头行（如 :'''into'''）：结束上一节，允许后续无词性的释义行
    if (/^:+\s*'''.+'''/.test(line) || /^:+\s*\{\{head/.test(line)) {
      skip = false
      pos = ''
      continue
    }
    if (/^:+/.test(line)) continue

    let content = ''
    let bucket = primary
    if (/^[*#]/.test(line)) {
      if (/^[*#]{2,}/.test(line)) continue
      if (/^#\s*$/.test(line)) continue
      if (/^\*\s*\{\{/.test(line)) {
        // 翻译块里的 `* {{zh}}：…` 行可用；其余模板行（发音、音频）不是释义
        content = cleanWikiText(chineseFromTranslationBullet(line))
      } else {
        content = cleanWikiText(chineseFromGlossaryLine(line) || line.replace(/^[*#]+\s*/, ''))
      }
    } else if (/^\{\{/.test(line) || /^\|/.test(line)) {
      continue
    } else if (/^\[\[\s*(?:File|Image|文件|檔案|档案|Category|分类|分類)\s*:/i.test(line)) {
      continue
    } else {
      // 裸行：部分词条直接以中文释义成段，如「意外、事故」；词源/用法说明在 isUsable 中剔除
      content = cleanWikiText(chineseFromGlossaryLine(line) || line)
      bucket = secondary
    }
    if (!content) continue
    if (!isUsableChineseDefinition(content)) continue
    if (skip && sawPosSection) continue
    pushUnique(bucket, { pos, meaning: content }, 3)
  }
  const out = []
  for (const item of primary) pushUnique(out, item, 3)
  for (const item of secondary) pushUnique(out, item, 3)
  return out
}

/**
 * 抽取 en.wiktionary 英语词条的英文释义（用于词组；单词优先用 WordNet）。
 * @returns {{pos: string, meaning: string}[]}
 */
export function extractEnglishDefinitions(wikitext) {
  const range = findSectionRange(wikitext, ['English'])
  if (!range) return []
  const lines = String(wikitext).split('\n').slice(range.start, range.end)
  const out = []
  let pos = ''
  let skip = false
  let sawHead = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const header = /^(={3,4})\s*([^=\n]+?)\s*\1\s*$/.exec(line)
    if (header) {
      const title = header[2].trim()
      const mapped = EN_POS_BY_NAME.get(title)
      if (mapped) {
        pos = mapped
        skip = false
        sawHead = true
      } else if (NON_POS_SECTIONS.has(title)) {
        skip = true
      }
      continue
    }
    if (!/^#(?![:*#])/.test(line)) continue
    if (skip && sawHead) continue
    const content = cleanWikiText(line.replace(/^#+\s*/, ''))
    if (!content) continue
    // 去掉开头的用法标签，如 (idiomatic)、[slang]
    const stripped = content.replace(/^(?:\([^()]{0,40}\)\s*)+/, '').replace(/^(?:\[[^\[\]]{0,40}\]\s*)+/, '').trim()
    if (!stripped) continue
    if (!isUsableEnglishDefinition(stripped)) continue
    pushUnique(out, { pos, meaning: stripped }, 3)
  }
  return out
}

const US_REGION_TOKENS = new Set([
  'us', 'ga', 'genam', 'general american', 'general american english', '美式', '美國', '美国',
])

function splitTemplateArgs(inner) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of inner) {
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (ch === '|' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts.map(p => p.trim())
}

function templateArgsAt(text, startIndex) {
  // startIndex 指向 '{{' 的第一个 '{'
  let depth = 0
  let i = startIndex
  for (; i < text.length; i++) {
    if (text.startsWith('{{', i)) { depth++; i++ ; continue }
    if (text.startsWith('}}', i)) {
      depth--
      if (depth === 0) {
        const inner = text.slice(startIndex + 2, i)
        return { args: splitTemplateArgs(inner), end: i + 2 }
      }
      i++
    }
  }
  return null
}

function collectRegionTokens(args) {
  const tokens = []
  for (const arg of args) {
    const m = /^(?:a|q|q\d|qq|qualifier|qual|label|lb)\s*=\s*(.*)$/i.exec(arg)
    if (!m) continue
    for (const piece of m[1].split(/[,;]/)) {
      const token = piece.trim().toLowerCase()
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function regionTokensFromLinePrefix(text, upto) {
  const prefix = text.slice(0, upto)
  const tokens = []
  let index = 0
  while (index < prefix.length) {
    const open = prefix.indexOf('{{', index)
    if (open < 0) break
    const parsed = templateArgsAt(prefix, open)
    if (!parsed) break
    const name = (parsed.args[0] || '').toLowerCase()
    if (['a', 'qualifier', 'qual', 'lb', 'label', 'q'].includes(name)) {
      for (const piece of parsed.args.slice(1).join(',').split(/[,;]/)) {
        const token = piece.trim().toLowerCase()
        if (token && !/^[a-z]{2,3}$/.test(token) || US_REGION_TOKENS.has(token)) tokens.push(token)
      }
    }
    index = parsed.end
  }
  return tokens
}

function isUsRegion(tokens) {
  return tokens.some(t => US_REGION_TOKENS.has(t))
}

function pickIpaValue(args) {
  const values = args.slice(1).filter(a => !a.includes('=') && a)
  const slash = values.find(v => v.startsWith('/'))
  if (slash) return slash
  const bracket = values.find(v => v.startsWith('['))
  if (bracket) return bracket
  return ''
}

/**
 * 抽取 en.wiktionary 英语词条中带明确美式地区标注的 IPA。
 * 未标注地区、仅英式或其他地区者一律返回 null（不猜测口音）。
 * @returns {string|null}
 */
export function extractUsIpa(wikitext) {
  const range = findSectionRange(wikitext, ['English'])
  if (!range) return null
  const text = String(wikitext).split('\n').slice(range.start, range.end).join('\n')
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('{{', index)
    if (open < 0) break
    const parsed = templateArgsAt(text, open)
    if (!parsed) break
    const name = (parsed.args[0] || '').trim().toUpperCase()
    if (name === 'IPA') {
      const args = parsed.args
      const lang = (args[1] || '').trim().toLowerCase()
      if (lang === 'en' || lang === 'english') {
        const tokens = [...collectRegionTokens(args.slice(2)), ...regionTokensFromLinePrefix(text, open)]
        if (isUsRegion(tokens)) {
          const value = pickIpaValue([args[0], ...args.slice(2)])
          if (value) return value
        }
      }
    }
    index = parsed.end
  }
  return null
}

export const __test__ = {
  findSectionRange,
  ZH_POS_BY_NAME,
  EN_POS_BY_NAME,
}
