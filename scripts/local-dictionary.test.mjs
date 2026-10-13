import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dictDir = path.resolve(import.meta.dirname, '../public/preload/dictionary')
const localDictionary = require('../public/preload/localDictionary.js')

test('本地词库运行数据完整性', async (t) => {
  const manifestFile = path.join(dictDir, 'manifest.json')

  await t.test('随包词库存在：manifest、分片、来源与许可', () => {
    assert.ok(fs.existsSync(manifestFile), '缺少 manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    assert.ok(manifest.counts.words >= 5000, `单词条目应约 5000，实际 ${manifest.counts.words}`)
    assert.ok(manifest.counts.phrases >= 500, `固定词组条目应约 500，实际 ${manifest.counts.phrases}`)
    assert.ok(Array.isArray(manifest.shards) && manifest.shards.length > 0)
    for (const shard of manifest.shards) {
      assert.ok(fs.existsSync(path.join(dictDir, 'shards', shard)), `缺少分片 ${shard}`)
    }
    for (const source of manifest.sources) {
      assert.ok(source.license && source.url, `数据源 ${source.id} 缺少许可或来源地址`)
      assert.ok(fs.existsSync(path.join(dictDir, source.licenseFile)), `缺少许可文本 ${source.licenseFile}`)
    }
    assert.ok(fs.existsSync(path.join(dictDir, 'SOURCES.json')))
    assert.ok(fs.existsSync(path.join(dictDir, 'COVERAGE.md')))
  })

  await t.test('覆盖率如实统计，且不写入空词条', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const { words, phrases } = manifest.coverage
    for (const group of [words, phrases]) {
      assert.ok(group.withUsIpa <= group.total)
      assert.ok(group.withChinese <= group.total)
      assert.ok(group.withEnglish <= group.total)
      assert.ok(group.withAllThree <= group.withChineseAndUsIpa)
    }
    // 每个分片中的词条至少有一个有效字段
    for (const shard of manifest.shards) {
      const data = JSON.parse(fs.readFileSync(path.join(dictDir, 'shards', shard), 'utf8'))
      for (const [key, entry] of Object.entries(data)) {
        const hasField = !!(entry.p && entry.p.v) || (Array.isArray(entry.zh) && entry.zh.length > 0) || (Array.isArray(entry.en) && entry.en.length > 0)
        assert.ok(hasField, `空词条不应写入：${key}`)
        if (entry.p) {
          assert.equal(entry.p.r, 'US', `音标必须带明确美式标记：${key}`)
        }
      }
    }
  })

  await t.test('parallel 具备美式 IPA、中文释义与英文释义（AC-003/AC-004）', () => {
    const entry = localDictionary.lookup('parallel')
    assert.equal(entry.found, true)
    assert.equal(entry.kind, 'word')
    assert.equal(entry.phonetic.region, 'US')
    assert.match(entry.phonetic.value, /^[/[]/)
    assert.ok(entry.definitions.zh.length > 0 && entry.definitions.zh.length <= 3)
    assert.ok(entry.definitions.en.length > 0 && entry.definitions.en.length <= 3)
    assert.match(entry.definitions.zh[0].meaning, /[\u3400-\u9fff]/)
    assert.doesNotMatch(entry.definitions.en[0].meaning, /[\u3400-\u9fff]/)
  })

  await t.test('查询规范化：大小写与空白不敏感，未命中返回 found:false', () => {
    assert.equal(localDictionary.lookup('  Parallel ').found, true)
    assert.equal(localDictionary.lookup('zzzz-not-a-word-zzzz').found, false)
    assert.equal(localDictionary.lookup('').found, false)
  })

  await t.test('info() 暴露版本、条目数与来源许可，不含词条正文', () => {
    const info = localDictionary.info()
    assert.equal(info.available, true)
    assert.ok(info.version)
    assert.ok(info.counts.words >= 5000)
    assert.ok(info.sources.length >= 4)
    for (const source of info.sources) {
      assert.ok(source.license)
      assert.ok(!Object.prototype.hasOwnProperty.call(source, 'entries'))
    }
  })

  await t.test('路径基于模块位置，不依赖进程工作目录', () => {
    const original = process.cwd()
    try {
      process.chdir(path.resolve(import.meta.dirname, '..'))
      localDictionary.resetCache()
      assert.equal(localDictionary.lookup('parallel').found, true)
    } finally {
      process.chdir(original)
    }
  })
})
