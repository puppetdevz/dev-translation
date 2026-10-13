#!/usr/bin/env node
/**
 * 本地双语词库导入工具（开发阶段；不在插件启动或构建时联网）。
 *
 * 数据源（全部为可再分发的公开数据，详见输出目录的 SOURCES.json 与 LICENSES/）：
 * - 词频清单：IlyaSemenov/wikipedia-word-frequency（MIT），用于选词与常用性排序
 * - 美式 IPA（单词）：open-dict-data/ipa-dict en_US（MIT，基于 cmudict-ipa / CMUdict）
 * - 英文解释性释义：Open English WordNet（CC BY 4.0）
 * - 固定词组（美式 IPA + 英文释义）：en.wiktionary（CC BY-SA 4.0）
 * - 中文释义：zh.wiktionary（CC BY-SA 4.0）
 *
 * 用法：
 *   node scripts/importDictionary.mjs                 # 使用 .dictionary-cache 缓存，缺失时下载
 *   node scripts/importDictionary.mjs --refresh       # 重新下载原始数据
 *   node scripts/importDictionary.mjs --words 5000 --phrases 500
 *
 * 输出：public/preload/dictionary/
 *   manifest.json          运行数据索引与覆盖统计
 *   shards/<bucket>.json   按首字符分片的词条数据（懒加载）
 *   SOURCES.json           来源、版本、下载日期、校验值、许可
 *   LICENSES/*.txt         第三方数据完整许可文本
 *   COVERAGE.md            覆盖率报告（真实统计，不填充空词条）
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  extractChineseDefinitions,
  extractEnglishDefinitions,
  extractUsIpa,
} from './dictionaryParsers.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(rootDir, '.dictionary-cache')
const rawDir = path.join(cacheDir, 'raw')
const wikiCacheDir = path.join(cacheDir, 'wikitext')
const outDir = path.join(rootDir, 'public', 'preload', 'dictionary')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}

const targetWords = opt('words', 5000)
const targetPhrases = opt('phrases', 500)
const refresh = flag('refresh')
const maxWordCandidates = opt('word-candidates', 9000)
const maxPhraseCandidatesFetched = opt('phrase-candidates', 60000)
const USER_AGENT = 'dev-translation-dictionary-import/1.0 (https://github.com/puppetdevz/dev-translation)'

const SOURCES = {
  wordFrequency: {
    id: 'wikipedia-word-frequency',
    name: 'Wikipedia word frequency (enwiki 2023-04-13)',
    url: 'https://raw.githubusercontent.com/IlyaSemenov/wikipedia-word-frequency/master/results/enwiki-2023-04-13.txt',
    repo: 'https://github.com/IlyaSemenov/wikipedia-word-frequency',
    license: 'MIT',
    licenseFile: 'LICENSES/wikipedia-word-frequency-MIT.txt',
    usage: '常用性依据：为单词候选排序、为固定词组按组成词词频排序（词组常用性代理指标）',
  },
  ipaUs: {
    id: 'ipa-dict-en-us',
    name: 'ipa-dict en_US (基于 cmudict-ipa / CMUdict)',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    repo: 'https://github.com/open-dict-data/ipa-dict',
    license: 'MIT',
    licenseFile: 'LICENSES/ipa-dict-MIT.txt',
    region: 'US',
    regionEvidence: '数据文件名与项目说明明确为 English (US)，非按 IPA 字符形状推断',
    usage: '单词的美式 IPA（唯一来源，不做口音映射）',
  },
  wordnet: {
    id: 'open-english-wordnet-2025',
    name: 'Open English WordNet 2025 edition',
    url: 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip',
    repo: 'https://github.com/globalwordnet/english-wordnet',
    license: 'CC BY 4.0',
    licenseFile: 'LICENSES/open-english-wordnet-CC-BY-4.0.txt',
    usage: '中译英方向的英文解释性释义；词组候选池（WordNet 词条身份）',
  },
  enWiktionary: {
    id: 'en-wiktionary',
    name: 'English Wiktionary（通过 MediaWiki API 按词条读取）',
    url: 'https://en.wiktionary.org/w/api.php',
    repo: 'https://en.wiktionary.org/',
    license: 'CC BY-SA 4.0',
    licenseFile: 'LICENSES/wiktionary-CC-BY-SA-4.0.txt',
    usage: '固定词组的美式 IPA（仅采用 GA/US/GenAm 等明确地区标注）与英文释义',
  },
  zhWiktionary: {
    id: 'zh-wiktionary',
    name: 'Chinese Wiktionary（通过 MediaWiki API 按词条读取）',
    url: 'https://zh.wiktionary.org/w/api.php',
    repo: 'https://zh.wiktionary.org/',
    license: 'CC BY-SA 4.0',
    licenseFile: 'LICENSES/wiktionary-CC-BY-SA-4.0.txt',
    usage: '英译中方向的中文释义（含词性），中文来源直接提供中文义项',
  },
}

const POS_ZH_TO_SHORT = {
  'n.': 'n.', 'v.': 'v.', 'adj.': 'adj.', 'adv.': 'adv.', 'prep.': 'prep.',
  'conj.': 'conj.', 'pron.': 'pron.', 'num.': 'num.', 'art.': 'art.', 'int.': 'int.',
  'part.': 'part.', 'aux.': 'aux.', 'phr.': 'phr.', 'abbr.': 'abbr.', 'prop.': 'prop.',
  'prefix': 'prefix', 'suffix': 'suffix', 'root': 'root', 'class.': 'class.', 'det.': 'det.',
  'punct.': 'punct.', 'letter': 'letter', 'symbol': 'symbol', 'contr.': 'contr.', 'postp.': 'postp.',
}

const OEWN_POS_SHORT = { n: 'n.', v: 'v.', a: 'adj.', s: 'adj.', r: 'adv.' }

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'as', 'by', 'from',
  'up', 'out', 'off', 'over', 'into', 'not', 'be', 'is', 'are', 'it', 'its', 'that', 'this',
])

function log(message) {
  process.stdout.write(`[dictionary] ${message}\n`)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// 下载记录：跨次运行保留（下载日期、校验值），用于交付时核对来源与版本
const downloadsFile = path.join(cacheDir, 'downloads.json')
let sourceRecords = {}
try {
  if (fs.existsSync(downloadsFile)) sourceRecords = JSON.parse(fs.readFileSync(downloadsFile, 'utf8'))
} catch {
  sourceRecords = {}
}

async function download(url, file, { optional = false } = {}) {
  ensureDir(path.dirname(file))
  const record = sourceRecords[file] || { url, downloadedAt: null }
  if (fs.existsSync(file) && !refresh) {
    // 缓存命中：保留首次下载日期（若历史记录缺失则用文件落盘时间），并重新校验当前文件校验值
    const stat = fs.statSync(file)
    sourceRecords[file] = {
      ...record,
      url,
      downloadedAt: record.downloadedAt || new Date(stat.mtimeMs).toISOString(),
      sha256: sha256(file),
      bytes: stat.size,
    }
    persistDownloadRecords()
    return file
  }
  log(`下载 ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    if (optional) {
      log(`可选数据源不可用（HTTP ${res.status}），跳过：${url}`)
      return null
    }
    throw new Error(`下载失败 HTTP ${res.status}: ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  sourceRecords[file] = {
    url,
    downloadedAt: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  }
  persistDownloadRecords()
  return file
}

function persistDownloadRecords() {
  try {
    ensureDir(cacheDir)
    fs.writeFileSync(downloadsFile, JSON.stringify(sourceRecords, null, 2))
  } catch {
    // 记录失败不影响词库生成
  }
}

/** 维基文本抓取证据：API 入口、缓存条目数与最早/最晚抓取时间。 */
function wikitextEvidence(project, api) {
  const dir = path.join(wikiCacheDir, project)
  if (!fs.existsSync(dir)) return { project, api, titles: 0, fetchedFrom: null, fetchedTo: null }
  const files = fs.readdirSync(dir)
  let oldest = Infinity
  let newest = 0
  let titles = 0
  for (const name of files) {
    const stat = fs.statSync(path.join(dir, name))
    oldest = Math.min(oldest, stat.mtimeMs)
    newest = Math.max(newest, stat.mtimeMs)
    if (stat.size > 0) titles += 1
  }
  return {
    project,
    api,
    titles,
    fetchedFrom: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    fetchedTo: newest ? new Date(newest).toISOString() : null,
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function wikiCacheFile(project, title) {
  return path.join(wikiCacheDir, project, `${encodeURIComponent(title)}.txt`)
}

async function wikiApi(project, host, params, tries = 8) {
  let lastError = null
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', ...params }).toString()}`
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      const text = await res.text()
      if (res.status !== 200 || text.startsWith('<')) throw new Error(`HTTP ${res.status}`)
      return JSON.parse(text)
    } catch (err) {
      lastError = err
      // Wikimedia 对突发请求会返回 429：指数退避后重试，不并发压测
      await sleep(Math.min(20000, 1500 * Math.pow(2, attempt)))
    }
  }
  throw new Error(`${project} API 调用失败：${lastError && lastError.message}`)
}

/**
 * 按标题批量读取维基文本并落盘缓存。已缓存的条目不重复请求。
 * @returns {Promise<Map<string,string|null>>} title(lowercased) -> wikitext|null
 */
async function fetchWikitext(project, host, titles) {
  ensureDir(path.join(wikiCacheDir, project))
  const unique = [...new Set(titles.map(t => String(t).trim()).filter(Boolean))]
  const out = new Map()
  const todo = []
  for (const title of unique) {
    const file = wikiCacheFile(project, title)
    if (fs.existsSync(file) && !refresh) {
      const cached = fs.readFileSync(file, 'utf8')
      out.set(title.toLowerCase(), cached && cached !== '__MISSING__' ? cached : null)
    } else {
      todo.push(title)
    }
  }
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50)
    const data = await wikiApi(project, host, {
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: batch.join('|'),
    })
    const redirectFrom = new Map()
    const redirectTo = new Map()
    for (const r of (data.query && data.query.redirects) || []) {
      redirectFrom.set(r.to, r.from)
      redirectTo.set(r.from, r.to)
    }
    const resolved = new Map()
    for (const page of Object.values((data.query && data.query.pages) || {})) {
      const content = page.revisions && page.revisions[0] && page.revisions[0].slots
        && page.revisions[0].slots.main && page.revisions[0].slots.main['*']
      if (content) resolved.set(page.title, content)
    }
    for (const title of batch) {
      const target = redirectTo.get(title) || title
      const content = resolved.get(target) || null
      fs.writeFileSync(wikiCacheFile(project, title), content ? content : '__MISSING__')
      if (content) {
        const canonical = redirectFrom.get(target)
        if (canonical) fs.writeFileSync(wikiCacheFile(project, canonical), content)
        fs.writeFileSync(wikiCacheFile(project, target), content)
      }
      out.set(title.toLowerCase(), content)
      if (target.toLowerCase() !== title.toLowerCase()) out.set(target.toLowerCase(), content)
    }
    if (i + 50 < todo.length) await sleep(400)
  }
  return out
}

/** 读取已缓存（或本次写入）的维基文本。 */
function readWikiCache(project, title) {
  const file = wikiCacheFile(project, title)
  if (!fs.existsSync(file)) return null
  const content = fs.readFileSync(file, 'utf8')
  return content && content !== '__MISSING__' ? content : null
}

// ---------- 数据源加载 ----------

function loadFrequency() {
  const file = path.join(rawDir, 'enwiki-freq.txt')
  const map = new Map()
  let rank = 0
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [word, countRaw] = line.trim().split(/\s+/)
    if (!word) continue
    rank += 1
    const count = Number(countRaw) || 0
    map.set(word.toLowerCase(), { rank, count })
  }
  return map
}
function loadUsIpa() {
  const file = path.join(rawDir, 'en_US.txt')
  const map = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [word, ipa] = line.split('\t')
    if (!word || !ipa) continue
    const key = word.trim().toLowerCase()
    const value = ipa.trim()
    if (!value) continue
    // 同一词存在多个读音时保留第一条（来源中按词头顺序列出）
    if (!map.has(key)) map.set(key, value)
  }
  return map
}

function loadWordNet() {
  const dir = path.join(rawDir, 'oewn')
  const synsets = new Map()
  for (const file of fs.readdirSync(dir)) {
    if (!/^(noun|verb|adj|adv)\./.test(file)) continue
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const [id, synset] of Object.entries(data)) {
      const gloss = (synset.definition || []).map(d => String(d).trim()).filter(Boolean)
      if (!gloss.length) continue
      synsets.set(id, { pos: OEWN_POS_SHORT[synset.partOfSpeech] || '', gloss, example: synset.example || [] })
    }
  }
  const entries = new Map()
  for (const file of fs.readdirSync(dir)) {
    if (!/^entries-/.test(file)) continue
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const [key, value] of Object.entries(data)) {
      const lower = key.toLowerCase()
      const existing = entries.get(lower)
      // 同一小写词形有多个条目时，优先全小写词条
      if (existing && existing.raw !== key && existing.raw === existing.raw.toLowerCase()) continue
      entries.set(lower, { raw: key, value })
    }
  }

  const definitionsOf = (word) => {
    const hit = entries.get(String(word).toLowerCase())
    if (!hit) return []
    const out = []
    for (const [pos, data] of Object.entries(hit.value)) {
      const shortPos = OEWN_POS_SHORT[pos] || ''
      for (const sense of data.sense || []) {
        const synset = synsets.get(sense.synset)
        if (!synset) continue
        for (const gloss of synset.gloss) {
          const meaning = gloss.replace(/\s+/g, ' ').trim()
          if (!meaning) continue
          if (out.some(x => x.meaning === meaning)) continue
          out.push({ pos: shortPos, meaning })
          if (out.length >= 3) return out
        }
      }
    }
    return out
  }

  const multiwordLemmas = () => {
    const list = []
    for (const [lower, hit] of entries) {
      if (!lower.includes(' ') || lower.length > 60) continue
      if (hit.raw !== lower) continue // 跳过含大写/特殊写法的专名
      const tokens = lower.split(/\s+/)
      if (tokens.length < 2 || tokens.length > 5) continue
      if (!tokens.every(t => /^[a-z][a-z'-]*$/.test(t))) continue
      list.push(lower)
    }
    return list
  }

  return { definitionsOf, multiwordLemmas, entryCount: entries.size }
}

const EN_PHRASE_CATEGORIES = [
  'Category:English idioms',
  'Category:English prepositional phrases',
  'Category:English phrasal verbs',
  'Category:English proverbs',
  'Category:English coordinated pairs',
  'Category:English similes',
]

async function fetchCategoryMembers(category, limit = 3000) {
  const cacheFile = path.join(cacheDir, 'categories', `${category.replace(/[^A-Za-z]+/g, '_')}.json`)
  ensureDir(path.dirname(cacheFile))
  if (fs.existsSync(cacheFile) && !refresh) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  }
  const out = []
  let cont
  do {
    const params = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmlimit: '500',
      cmnamespace: '0',
    }
    if (cont) params.cmcontinue = cont
    const data = await wikiApi('en-wiktionary', 'en.wiktionary.org', params)
    if (!data.query) break
    out.push(...data.query.categorymembers.map(m => m.title))
    cont = data.continue && data.continue.cmcontinue
    if (cont) await sleep(300)
  } while (cont && out.length < limit)
  fs.writeFileSync(cacheFile, JSON.stringify(out))
  return out
}

// ---------- 选词 ----------

function buildWordCandidates(frequency) {
  const candidates = []
  for (const [word] of frequency) {
    if (candidates.length >= maxWordCandidates) break
    if (!/^[a-z][a-z'-]{1,23}$/.test(word)) continue
    if (word.includes("'") && word.length < 3) continue
    candidates.push(word)
  }
  const devTerms = JSON.parse(fs.readFileSync(path.join(rootDir, 'scripts', 'dictionaryDevTerms.json'), 'utf8')).words
  const devExtra = devTerms
    .map(w => String(w).toLowerCase())
    .filter(w => !candidates.includes(w))
  return { candidates, devExtra }
}

function phraseScore(lemma, frequency) {
  const tokens = lemma.split(/\s+/)
  if (!tokens.every(t => frequency.has(t))) return null
  if (!tokens.filter(t => !STOPWORDS.has(t)).length) return null
  let score = 0
  for (const t of tokens) score += Math.log10((frequency.get(t) && frequency.get(t).count) + 1)
  return score
}

/** 词组候选池：WordNet 多词词条 + en.wiktionary 可信表达分类成员，按常用性代理排序。 */
function buildPhraseCandidates(wordnet, frequency, categoryMembers) {
  const seen = new Set()
  const list = []
  const add = (lemma, pool) => {
    const key = lemma.trim().toLowerCase()
    if (!key || seen.has(key)) return
    if (!key.includes(' ') || key.length > 60) return
    if (!/^[a-z][a-z' -]*$/.test(key)) return
    if (key.split(/\s+/).length > 6) return
    const score = phraseScore(key, frequency)
    if (score == null) return
    seen.add(key)
    list.push({ lemma: key, score, pool })
  }
  for (const lemma of wordnet.multiwordLemmas()) add(lemma, 'oewn')
  for (const lemma of categoryMembers) add(lemma, 'enwiktionary')
  list.sort((a, b) => (b.score - a.score) || (a.lemma < b.lemma ? -1 : 1))
  return list
}

// ---------- 入口 ----------

async function main() {
  ensureDir(rawDir)
  ensureDir(wikiCacheDir)

  log('准备原始数据')
  await download(SOURCES.ipaUs.url, path.join(rawDir, 'en_US.txt'))
  await download(SOURCES.wordFrequency.url, path.join(rawDir, 'enwiki-freq.txt'))
  const wordnetZip = path.join(rawDir, 'oewn.json.zip')
  await download(SOURCES.wordnet.url, wordnetZip)
  const oewnDir = path.join(rawDir, 'oewn')
  if (!fs.existsSync(path.join(oewnDir, 'entries-a.json')) || refresh) {
    log('解压 WordNet 数据')
    fs.rmSync(oewnDir, { recursive: true, force: true })
    ensureDir(oewnDir)
    const { execFileSync } = await import('node:child_process')
    execFileSync('unzip', ['-o', '-q', wordnetZip, '-d', oewnDir])
  }
  await writeLicenses()

  log('加载词频、美式 IPA、WordNet')
  const frequency = loadFrequency()
  const ipa = loadUsIpa()
  const wordnet = loadWordNet()

  const { candidates, devExtra } = buildWordCandidates(frequency)
  const categoryMembers = []
  for (const category of EN_PHRASE_CATEGORIES) {
    const members = await fetchCategoryMembers(category)
    categoryMembers.push(...members.filter(t => t.includes(' ')))
  }
  const phraseCandidates = buildPhraseCandidates(wordnet, frequency, categoryMembers)
  log(`单词候选 ${candidates.length}（另含开发常用词 ${devExtra.length}），词组候选 ${phraseCandidates.length}`)

  // 单词：先取中文释义，按频率顺序收集到目标数量
  // 开发常用词优先占位，其余按词频顺序补齐
  const wordsToFetch = [...new Set([...devExtra, ...candidates])]
  log(`读取 zh.wiktionary 中文释义（${wordsToFetch.length} 条标题）`)
  await fetchWikitext('zh-wiktionary', 'zh.wiktionary.org', wordsToFetch)

  const wordEntries = new Map()
  const pushWord = (word, strict) => {
    const zh = extractChineseDefinitions(readWikiCache('zh-wiktionary', word) || '')
    const en = wordnet.definitionsOf(word)
    const usIpa = ipa.get(word) || null
    const fields = (zh.length ? 1 : 0) + (en.length ? 1 : 0) + (usIpa ? 1 : 0)
    if (fields === 0) return false
    if (strict && !zh.length) return false
    wordEntries.set(word, { w: word, k: 'wd', usIpa, zh, en, enSource: 'oewn' })
    return true
  }

  for (const word of wordsToFetch) {
    if (wordEntries.size >= targetWords) break
    // 优先收录有中文释义的词条，覆盖率如实报告
    pushWord(word, true)
  }
  for (const word of wordsToFetch) {
    if (wordEntries.size >= targetWords) break
    pushWord(word, false)
  }
  log(`单词条目 ${wordEntries.size}`)

  // 词组：整组美式 IPA 为硬条件（仅采用来源明确标注 US/GA/GenAm 的读音）。
  // 先按常用性代理顺序扫描整个候选池（维基文本落盘缓存），再在带 IPA 的条目中取最常用的一批。
  log('读取 en.wiktionary 词组 IPA 与英文释义（按常用性代理顺序）')
  const poolLimit = Math.min(phraseCandidates.length, maxPhraseCandidatesFetched)
  const phrasePool = phraseCandidates.slice(0, poolLimit)
  const chunkSize = 2000
  for (let offset = 0; offset < phrasePool.length; offset += chunkSize) {
    const chunk = phrasePool.slice(offset, offset + chunkSize)
    await fetchWikitext('en-wiktionary', 'en.wiktionary.org', chunk.map(c => c.lemma))
    log(`词组维基文本进度 ${Math.min(offset + chunk.length, phrasePool.length)}/${phrasePool.length}`)
  }

  const phraseWithIpa = []
  for (const candidate of phrasePool) {
    const wikitext = readWikiCache('en-wiktionary', candidate.lemma)
    if (!wikitext) continue
    const usIpa = extractUsIpa(wikitext)
    if (!usIpa) continue
    const en = wordnet.definitionsOf(candidate.lemma)
    const enFallback = en.length ? en : extractEnglishDefinitions(wikitext)
    phraseWithIpa.push({
      lemma: candidate.lemma,
      usIpa,
      en: enFallback,
      enSource: en.length ? 'oewn' : 'en-wiktionary',
      score: candidate.score,
    })
  }
  log(`带明确美式 IPA 的词组候选 ${phraseWithIpa.length}`)

  await fetchWikitext('zh-wiktionary', 'zh.wiktionary.org', phraseWithIpa.map(p => p.lemma))

  const phraseEntries = new Map()
  const addPhrase = (item, strict) => {
    const zh = extractChineseDefinitions(readWikiCache('zh-wiktionary', item.lemma) || '')
    if (!zh.length && strict) return false
    if (!zh.length && !item.en.length) return false
    phraseEntries.set(item.lemma, { w: item.lemma, k: 'ph', usIpa: item.usIpa, zh, en: item.en, enSource: item.enSource })
    return true
  }
  // 先收录同时有中文释义的词条，再按常用性顺序补齐到目标规模
  for (const item of phraseWithIpa) {
    if (phraseEntries.size >= targetPhrases) break
    addPhrase(item, true)
  }
  for (const item of phraseWithIpa) {
    if (phraseEntries.size >= targetPhrases) break
    addPhrase(item, false)
  }
  log(`词组条目 ${phraseEntries.size}`)

  writeDictionary(wordEntries, phraseEntries)
  writeReport(wordEntries, phraseEntries, frequency)
}

const ATTRIBUTION = {
  'wikipedia-word-frequency': [
    'Wikipedia word frequency lists (enwiki-2023-04-13)',
    'Copyright (c) 2015 Ilya Semenov — MIT License',
    '来源：https://github.com/IlyaSemenov/wikipedia-word-frequency',
    '使用方式：仅作选词与排序依据；未复制词表正文进入插件数据。',
  ].join('\n'),
  'ipa-dict-en-us': [
    'ipa-dict — English (US) pronunciation list (data/en_US.txt)',
    'Copyright (c) 2016 dohliam — MIT License',
    '来源：https://github.com/open-dict-data/ipa-dict',
    '上游说明：English (US) IPA data based on a modified version of cmudict-ipa (MIT) by @lingz, with stress markers via syllabify by @kylebgorman.',
    '使用方式：仅提取词形与其美式 IPA，未做口音推断或改写。',
  ].join('\n'),
  'open-english-wordnet-2025': [
    'Open English WordNet 2025 edition',
    'Copyright © 2018–2025 the Open English WordNet team and contributors.',
    '来源：https://github.com/globalwordnet/english-wordnet — CC BY 4.0',
    '使用方式：提取词性、释义（definition）与多词词条身份；未向词典释义之外扩散，未改动原始释义文本语序。',
  ].join('\n'),
  'en-wiktionary': [
    'English Wiktionary entries (en.wiktionary.org), retrieved via the MediaWiki API.',
    'Copyright © Wiktionary contributors — CC BY-SA 4.0（与 GFDL 双许可）',
    '来源：https://en.wiktionary.org/',
    '使用方式：仅提取带明确美式（US/GA/GenAm）地区标注的音标与英文释义；未把未标注地区或英式发音当作美式。',
  ].join('\n'),
  'zh-wiktionary': [
    'Chinese Wiktionary entries (zh.wiktionary.org), retrieved via the MediaWiki API.',
    'Copyright © 维基词典贡献者 — CC BY-SA 4.0（与 GFDL 双许可）',
    '来源：https://zh.wiktionary.org/',
    '使用方式：仅提取英语词条的中文释义与词性标记。',
  ].join('\n'),
}

const LICENSE_FILES = [
  {
    file: 'LICENSES/wikipedia-word-frequency-MIT.txt',
    url: 'https://raw.githubusercontent.com/IlyaSemenov/wikipedia-word-frequency/master/LICENSE',
    attribution: ATTRIBUTION['wikipedia-word-frequency'],
  },
  {
    file: 'LICENSES/ipa-dict-MIT.txt',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/LICENSE',
    attribution: ATTRIBUTION['ipa-dict-en-us'],
  },
  {
    file: 'LICENSES/open-english-wordnet-CC-BY-4.0.txt',
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode.txt',
    attribution: ATTRIBUTION['open-english-wordnet-2025'],
  },
  {
    file: 'LICENSES/wiktionary-CC-BY-SA-4.0.txt',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt',
    attribution: [ATTRIBUTION['en-wiktionary'], '', ATTRIBUTION['zh-wiktionary']].join('\n'),
  },
]

async function writeLicenses() {
  const dir = path.join(outDir, 'LICENSES')
  ensureDir(dir)
  for (const item of LICENSE_FILES) {
    const target = path.join(outDir, item.file)
    const banner = `${'-'.repeat(72)}\n${item.attribution}\n来源文件：${item.url}\n${'-'.repeat(72)}\n\n`
    if (fs.existsSync(target) && !refresh) continue
    log(`准备数据许可：${item.file}`)
    const res = await fetch(item.url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`许可文本下载失败 HTTP ${res.status}: ${item.url}`)
    fs.writeFileSync(target, banner + (await res.text()))
  }
  const readme = path.join(dir, 'README.md')
  if (!fs.existsSync(readme) || refresh) {
    const lines = [
      '# 本地词库第三方数据许可与署名',
      '',
      '本目录保存随插件分发的词库数据（`shards/`、`manifest.json`）所依据的原始数据许可全文与署名说明。',
      '',
      '| 数据源 | 许可 | 许可全文 |',
      '| --- | --- | --- |',
      '| ipa-dict en_US（单词美式 IPA） | MIT | `ipa-dict-MIT.txt` |',
      '| Wikipedia word frequency（选词/排序依据） | MIT | `wikipedia-word-frequency-MIT.txt` |',
      '| Open English WordNet 2025（英文释义/词组候选） | CC BY 4.0 | `open-english-wordnet-CC-BY-4.0.txt` |',
      '| en.wiktionary / zh.wiktionary（词组美式 IPA、中文释义） | CC BY-SA 4.0 | `wiktionary-CC-BY-SA-4.0.txt` |',
      '',
      '## 许可边界',
      '',
      '- 仓库代码許可为 GPL-3.0-only；第三方词库数据不因放入本仓库而改以 GPL-3.0-only 分发。',
      '- 由 Wiktionary 数据衍生出的词库内容（中文释义、词组美式 IPA、词组英文释义）继续以 CC BY-SA 4.0 相同方式共享，并保留署名与来源链接。',
      '- Open English WordNet 释义以 CC BY 4.0 署名方式使用。',
      '- 运行数据只保留筛选后的词条与字段，不包含原始全量下载库；原始文件的 URL、日期、体积与 SHA-256 见 `SOURCES.json`。',
      '- 复现方式：`node scripts/importDictionary.mjs`（开发阶段执行，不在插件启动或构建时联网）。',
      '',
    ]
    fs.writeFileSync(readme, lines.join('\n'))
  }
}

function normalizeKey(word) {
  return String(word).trim().toLowerCase().replace(/\s+/g, ' ')
}

function bucketOf(key) {
  const ch = key[0] || '_'
  return /[a-z]/.test(ch) ? ch : '_'
}

function writeDictionary(wordEntries, phraseEntries) {
  ensureDir(outDir)
  const shardsDir = path.join(outDir, 'shards')
  fs.rmSync(shardsDir, { recursive: true, force: true })
  ensureDir(shardsDir)

  const shards = new Map()
  const addEntry = (key, entry) => {
    const normalized = normalizeKey(key)
    const bucket = bucketOf(normalized)
    if (!shards.has(bucket)) shards.set(bucket, {})
    const data = {
      w: entry.w,
      k: entry.k,
    }
    if (entry.usIpa) data.p = { v: entry.usIpa, r: 'US', s: 'ipa-dict-en-us' }
    if (entry.zh && entry.zh.length) data.zh = entry.zh.map(d => compactDefinition(d, 'zh-wiktionary'))
    if (entry.en && entry.en.length) {
      data.en = entry.en.map(d => compactDefinition(d, entry.enSource || 'oewn'))
    }
    shards.get(bucket)[normalized] = data
  }

  for (const [key, entry] of wordEntries) addEntry(key, entry)
  for (const [key, entry] of phraseEntries) addEntry(key, entry)

  const shardNames = []
  for (const [bucket, data] of [...shards.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const name = `${bucket}.json`
    fs.writeFileSync(path.join(shardsDir, name), JSON.stringify(data))
    shardNames.push(name)
  }

  const manifest = {
    version: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    lookup: {
      normalization: 'trim + 小写 + 合并空白；另外尝试连字符/空格互换变体（仅当对应词条确实存在）',
      kinds: { wd: '单词', ph: '固定词组' },
      region: 'p.r=US 表示来源已明确标注美式读音；无该字段即不展示音标',
      definitions: 'zh=中文释义（英译中方向），en=英文解释性释义（中译英方向），最多 3 条',
    },
    counts: {
      words: wordEntries.size,
      phrases: phraseEntries.size,
      entries: wordEntries.size + phraseEntries.size,
    },
    coverage: coverageOf([...wordEntries.values()], [...phraseEntries.values()]),
    shards: shardNames,
    sources: Object.values(SOURCES).map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      repo: s.repo,
      license: s.license,
      licenseFile: s.licenseFile,
      usage: s.usage,
      ...(s.region ? { region: s.region, regionEvidence: s.regionEvidence } : {}),
    })),
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const sourcesFile = {
    generatedAt: manifest.generatedAt,
    note: '原始下载数据的下载日期、体积与 SHA-256 校验值；原始大文件与维基文本缓存不进入插件包。',
    downloads: Object.entries(sourceRecords).map(([file, record]) => ({
      file: path.relative(rootDir, file),
      ...record,
    })),
    wikitext: [
      wikitextEvidence('en-wiktionary', 'https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1'),
      wikitextEvidence('zh-wiktionary', 'https://zh.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1'),
    ],
  }
  fs.writeFileSync(path.join(outDir, 'SOURCES.json'), JSON.stringify(sourcesFile, null, 2))

  const totalBytes = shardNames.reduce((sum, name) => sum + fs.statSync(path.join(shardsDir, name)).size, 0)
    + fs.statSync(path.join(outDir, 'manifest.json')).size
  log(`运行数据 ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB（${shardNames.length} 个分片）`)
}

function compactDefinition(def, source) {
  const out = { m: String(def.meaning || '').trim() }
  if (def.pos) out.p = def.pos
  out.s = source
  return out
}

function coverageOf(words, phrases) {
  const count = (list, predicate) => list.filter(predicate).length
  const summarize = (list) => ({
    total: list.length,
    withUsIpa: count(list, e => !!e.usIpa),
    withChinese: count(list, e => Array.isArray(e.zh) && e.zh.length > 0),
    withEnglish: count(list, e => Array.isArray(e.en) && e.en.length > 0),
    withChineseAndUsIpa: count(list, e => !!e.usIpa && e.zh && e.zh.length > 0),
    withAllThree: count(list, e => !!e.usIpa && e.zh && e.zh.length > 0 && e.en && e.en.length > 0),
  })
  return { words: summarize(words), phrases: summarize(phrases) }
}

function writeReport(wordEntries, phraseEntries, frequency) {
  const words = [...wordEntries.values()]
  const phrases = [...phraseEntries.values()]
  const coverage = coverageOf(words, phrases)
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '0%')
  const lines = []
  lines.push('# 本地词库覆盖率报告')
  lines.push('')
  lines.push(`- 生成时间：${new Date().toISOString()}`)
  lines.push(`- 单词条目：${coverage.words.total}（目标 ${targetWords}）`)
  lines.push(`- 固定词组条目：${coverage.phrases.total}（目标 ${targetPhrases}）`)
  lines.push('')
  lines.push('> 覆盖数量按字段单独统计；只有表头没有任何有效字段的空词条不会被写入词库，因此不计入以上条目数。')
  lines.push('')
  lines.push('| 类别 | 条目数 | 美式 IPA | 中文释义 | 英文释义 | 美式 IPA + 中文释义 | 三项齐全 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [label, c] of [['单词', coverage.words], ['固定词组', coverage.phrases]]) {
    lines.push(`| ${label} | ${c.total} | ${c.withUsIpa}（${pct(c.withUsIpa, c.total)}） | ${c.withChinese}（${pct(c.withChinese, c.total)}） | ${c.withEnglish}（${pct(c.withEnglish, c.total)}） | ${c.withChineseAndUsIpa}（${pct(c.withChineseAndUsIpa, c.total)}） | ${c.withAllThree}（${pct(c.withAllThree, c.total)}） |`)
  }
  lines.push('')
  lines.push('## 代表性样本')
  lines.push('')
  const sample = (list, title) => {
    lines.push(`### ${title}`)
    lines.push('')
    for (const entry of list) {
      lines.push(`- \`${entry.w}\` — IPA：${entry.usIpa || '（无）'}；中文：${(entry.zh || []).map(d => `${d.pos}${d.meaning}`.trim()).join('；') || '（无）'}；英文：${(entry.en || []).map(d => d.meaning).join('；') || '（无）'}`)
    }
    lines.push('')
  }
  sample(wordEntries.get('parallel') ? [wordEntries.get('parallel')] : [], 'parallel（目标样本）')
  sample(phrases.slice(0, 12), '固定词组样本（按交付顺序取前 12 条）')
  lines.push('## 选词与排序依据')
  lines.push('')
  lines.push('- 单词：以 Wikipedia enwiki 2023-04-13 词频表降序取常用词，另加入 `scripts/dictionaryDevTerms.json` 中人工整理的开发常用词形清单。')
  lines.push('- 固定词组：候选池来自 Open English WordNet 的多词词条（词典词条身份），以各组成词在词频表中的词频之和的对数为常用性代理指标排序；整组美式 IPA 仅采用 en.wiktionary 中带 US/GA/GenAm 等明确地区标注的读音。')
  lines.push('- 未标注地区的 IPA、仅英式 IPA 一律不收录，也不由逐词读音拼接词组读音。')
  lines.push('- 中英文义项不按数组下标强制对齐；无来源支持时宁缺不造。')
  lines.push('')
  fs.writeFileSync(path.join(outDir, 'COVERAGE.md'), lines.join('\n'))
  log(`覆盖统计：单词 ${JSON.stringify(coverage.words)}；词组 ${JSON.stringify(coverage.phrases)}`)
}

main().catch(err => {
  process.stderr.write(`[dictionary] 失败：${err && err.stack ? err.stack : err}\n`)
  process.exit(1)
})
