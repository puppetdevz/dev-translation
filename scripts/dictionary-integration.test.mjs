import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  hasUsableDefinitions,
  hasUsablePhonetic,
  mergeDictionarySupplement,
  safeLookupLocalDictionary,
} from '../src/Translate/utils/engineBridge.js'
import { formatVariableNames } from '../src/Translate/utils/variableNaming.js'
import { runAiNaming, AI_NAMING_STATUS } from '../src/Translate/utils/aiNaming.js'

const require = createRequire(import.meta.url)
const localDictionary = require('../public/preload/localDictionary.js')

/** 用真实打包词库模拟 preload 桥接，验证「词库 → 补全 → 展示字段」的完整链路。 */
const env = {
  services: {
    lookupLocalDictionary: (key) => localDictionary.lookup(key),
  },
}

test('本地词库 → 字段级补全 → 命名格式的完整链路', async (t) => {
  await t.test('英译中：parallel 从词库补出美式 IPA 与中文释义', async () => {
    const entry = await safeLookupLocalDictionary('  Parallel ', env)
    assert.ok(entry && entry.found)

    // AI 只给出中文主译文（无音标、无释义）时的补全
    const merged = mergeDictionarySupplement({
      result: { translation: '平行的' },
      localEntry: entry,
      onlineEntry: null,
      lang: 'en',
    })
    assert.equal(hasUsablePhonetic(merged.result.phonetic), true)
    assert.equal(hasUsableDefinitions(merged.result.definitions, 'en'), true)
    assert.ok(merged.result.definitions.length <= 3)
    assert.equal(merged.filled.phonetic, true)
    assert.equal(merged.filled.definitions, true)
    // 主译文不被覆盖
    assert.equal(merged.result.translation, '平行的')
  })

  await t.test('中译英：parallel 从词库补出英文解释性释义而非中文义项', async () => {
    const entry = await safeLookupLocalDictionary('parallel', env)
    const merged = mergeDictionarySupplement({
      result: { translation: 'parallel' },
      localEntry: entry,
      onlineEntry: null,
      lang: 'zh',
    })
    assert.equal(hasUsableDefinitions(merged.result.definitions, 'zh'), true)
    assert.match(merged.result.definitions[0].meaning, /[A-Za-z]/)
    assert.deepEqual(merged.result.definitions.map(d => d.meaning), entry.definitions.en.slice(0, 3).map(d => d.meaning))
  })

  await t.test('固定词组整组命中，且不拆词拼接', async () => {
    const entry = await safeLookupLocalDictionary('absolute zero', env)
    assert.ok(entry && entry.found)
    assert.equal(entry.kind, 'phrase')
    assert.equal(entry.phonetic.region, 'US')
    assert.ok(entry.definitions.en.length > 0)
  })

  await t.test('表外词不伪造资料', async () => {
    const entry = await safeLookupLocalDictionary('zorblat', env)
    assert.equal(entry, null)
    const merged = mergeDictionarySupplement({
      result: { translation: '虚构词' },
      localEntry: entry,
      onlineEntry: null,
      lang: 'en',
    })
    assert.equal(merged.result.phonetic, undefined)
    assert.equal(merged.result.definitions, undefined)
  })

  await t.test('AI 命名结果与常规命名共用同一套 5 种格式', () => {
    const aiItems = formatVariableNames(['discovery', 'count'])
    const regularItems = formatVariableNames(['discovery', 'count'])
    assert.deepEqual(aiItems.map(i => i.label), ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE', 'kebab-case'])
    assert.deepEqual(aiItems.map(i => i.value), [
      'discoveryCount', 'DiscoveryCount', 'discovery_count', 'DISCOVERY_COUNT', 'discovery-count',
    ])
    assert.deepEqual(aiItems, regularItems)
  })

  await t.test('AI 命名在真实词库存在与否时行为一致，不读写词库', async () => {
    let namingCalls = 0
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: {
        thirdpartyAiGroups: [{ id: 'g_a', name: 'g', url: 'https://api.example.com/v1', apiKey: 'k', model: 'm' }],
      },
      messages: [{ role: 'system', content: 'contract' }, { role: 'user', content: 'parallel' }],
      budgetMs: 1500,
      groupTimeoutMs: 1500,
      env: {
        utools: {},
        services: {
          requestThirdpartyAI: async () => {
            namingCalls += 1
            return { choices: [{ message: { content: '{"shouldName":true,"words":["discovery","count"]}' } }] }
          },
          lookupLocalDictionary: () => { throw new Error('命名不应访问词库') },
        },
      },
    })
    assert.equal(namingCalls, 1)
    assert.equal(result.status, AI_NAMING_STATUS.READY)
    assert.deepEqual(result.words, ['discovery', 'count'])
    assert.deepEqual(formatVariableNames(result.words).map(i => i.value), [
      'discoveryCount', 'DiscoveryCount', 'discovery_count', 'DISCOVERY_COUNT', 'discovery-count',
    ])
  })
})
