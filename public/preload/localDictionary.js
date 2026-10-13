'use strict'

/**
 * 本地双语词库读取（preload / Node 上下文）。
 *
 * - 随插件打包，运行时不联网、不下载、不更新；
 * - 按首字符分片懒加载并缓存：首次查询某个分片时才解析该分片 JSON；
 * - 使用模块相对路径（__dirname），不依赖进程工作目录；
 * - 任何读取/解析失败都降级为「未命中」，不抛错、不阻断 window.services 初始化。
 */

const fs = require('node:fs')
const path = require('node:path')

const DICTIONARY_DIR = path.join(__dirname, 'dictionary')
const SHARD_DIR = path.join(DICTIONARY_DIR, 'shards')

let manifest = null
let manifestTried = false
const shardCache = new Map()
const resultCache = new Map()

function readManifest () {
  if (manifestTried) return manifest
  manifestTried = true
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DICTIONARY_DIR, 'manifest.json'), 'utf8'))
    manifest = parsed && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    manifest = null
  }
  return manifest
}

function normalizeKey (key) {
  return String(key == null ? '' : key).trim().toLowerCase().replace(/\s+/g, ' ')
}

function bucketOf (key) {
  const first = key.charAt(0)
  return /[a-z]/.test(first) ? first : '_'
}

function loadShard (bucket) {
  if (shardCache.has(bucket)) return shardCache.get(bucket)
  let data = null
  try {
    const file = path.join(SHARD_DIR, `${bucket}.json`)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    data = parsed && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    data = null
  }
  shardCache.set(bucket, data)
  return data
}

function toResult (key, entry) {
  const phoneticMeta = entry && entry.p && typeof entry.p === 'object' ? entry.p : null
  return {
    found: true,
    key,
    kind: entry && entry.k === 'ph' ? 'phrase' : 'word',
    headword: entry && entry.w ? String(entry.w) : key,
    phonetic: {
      value: phoneticMeta && typeof phoneticMeta.v === 'string' ? phoneticMeta.v : '',
      // 只有来源明确标注美式时才是 'US'；渲染侧只接受 US。
      region: phoneticMeta && typeof phoneticMeta.r === 'string' ? phoneticMeta.r : '',
      source: phoneticMeta && typeof phoneticMeta.s === 'string' ? phoneticMeta.s : '',
    },
    definitions: {
      zh: (entry && Array.isArray(entry.zh) ? entry.zh : []).map(d => ({
        pos: d && d.p ? String(d.p) : '',
        meaning: d && d.m ? String(d.m) : '',
        source: d && d.s ? String(d.s) : '',
      })),
      en: (entry && Array.isArray(entry.en) ? entry.en : []).map(d => ({
        pos: d && d.p ? String(d.p) : '',
        meaning: d && d.m ? String(d.m) : '',
        source: d && d.s ? String(d.s) : '',
      })),
    },
  }
}

function lookup (key) {
  const normalized = normalizeKey(key)
  if (!normalized) return { found: false }
  if (resultCache.has(normalized)) return resultCache.get(normalized)
  const shard = loadShard(bucketOf(normalized))
  const entry = shard ? shard[normalized] : null
  const result = entry && typeof entry === 'object' ? toResult(normalized, entry) : { found: false }
  resultCache.set(normalized, result)
  return result
}

/** 词库元信息（版本、条目数、来源），读取失败时返回 available:false。 */
function info () {
  const data = readManifest()
  if (!data) return { available: false }
  return {
    available: true,
    version: data.version || '',
    generatedAt: data.generatedAt || '',
    counts: data.counts || {},
    coverage: data.coverage || {},
    sources: Array.isArray(data.sources) ? data.sources.map(s => ({
      id: s.id,
      name: s.name,
      license: s.license,
      url: s.url,
    })) : [],
  }
}

/** 仅供隔离测试使用：清空缓存。 */
function resetCache () {
  manifest = null
  manifestTried = false
  shardCache.clear()
  resultCache.clear()
}

module.exports = { lookup, info, resetCache, DICTIONARY_DIR }
