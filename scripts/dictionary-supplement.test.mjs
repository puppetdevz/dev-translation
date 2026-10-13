import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DICTIONARY_BUDGET_MS,
  attachDefinitionExamples,
  canApplyDictionarySupplement,
  canPromoteMisclassifiedPhrase,
  dictionaryKeyVariants,
  dictionaryLookupTarget,
  dictionaryStatusAfterBudget,
  hasUsableDefinitions,
  hasUsablePhonetic,
  isDictionaryWriteExpired,
  mergeDictionarySupplement,
  normalizeDictionaryKey,
  normalizePartOfSpeech,
  waitWithBudget,
  pickLocalDefinitions,
  pickLocalPhonetic,
  safeLookupLocalDictionary,
  safeLookupWord,
} from '../src/Translate/utils/engineBridge.js'

function localEntry(overrides = {}) {
  return {
    found: true,
    key: 'parallel',
    kind: 'word',
    headword: 'parallel',
    phonetic: { value: '/ˈpæɹəˌlɛl/', region: 'US', source: 'ipa-dict-en-us' },
    definitions: {
      zh: [{ pos: 'adj.', meaning: '平行的', source: 'zh-wiktionary' }],
      en: [{ pos: 'adj.', meaning: 'equally distant from one another', source: 'oewn' }],
    },
    ...overrides,
  }
}

test('词典查询目标与键规范化', async (t) => {
  await t.test('英译中查英文原文，中译英查成功主译文', () => {
    assert.deepEqual(
      dictionaryLookupTarget({ type: 'word', lang: 'en', sourceText: 'Parallel', translation: '平行的' }),
      { target: 'parallel', allowNetwork: true, phraseOnly: false },
    )
    assert.deepEqual(
      dictionaryLookupTarget({ type: 'word', lang: 'zh', sourceText: '平行的', translation: 'Parallel' }),
      { target: 'parallel', allowNetwork: true, phraseOnly: false },
    )
  })

  await t.test('句子分支只允许用完整词条命中固定词组，不发起在线查询', () => {
    const target = dictionaryLookupTarget({
      type: 'sentence',
      lang: 'en',
      sourceText: 'As Well As',
      translation: '和',
    })
    assert.equal(target.target, 'as well as')
    assert.equal(target.allowNetwork, false)
    assert.equal(target.phraseOnly, true)
  })

  await t.test('规范化只处理大小写与空白，不做词形合并', () => {
    assert.equal(normalizeDictionaryKey('  In   Front  Of '), 'in front of')
    assert.deepEqual(dictionaryKeyVariants('e-mail'), ['e-mail', 'e mail'])
    assert.deepEqual(dictionaryKeyVariants('as well as'), ['as well as', 'as-well-as'])
    assert.deepEqual(dictionaryKeyVariants('   '), [])
  })

  await t.test('删除连字符不得把不同词条当成同一查询', () => {
    assert.equal(dictionaryKeyVariants('re-sign').includes('resign'), false)
    assert.equal(dictionaryKeyVariants('well-known').includes('wellknown'), false)
  })

  await t.test('总预算为 5000ms，独立于引擎时限', () => {
    assert.equal(DICTIONARY_BUDGET_MS, 5000)
    assert.equal(isDictionaryWriteExpired(1000, 1001), true)
    assert.equal(isDictionaryWriteExpired(1000, 1000), false)
  })

  await t.test('中译英句子只有英文译文整组命中词组且原文无句末标点时才提升', () => {
    const phrase = localEntry({ key: 'as well as', kind: 'phrase', headword: 'as well as' })
    assert.equal(canPromoteMisclassifiedPhrase({
      type: 'sentence',
      sourceText: '以及另外一件很长的事情',
      target: 'as well as',
      localEntry: phrase,
    }), true)
    assert.equal(canPromoteMisclassifiedPhrase({
      type: 'sentence',
      sourceText: '以及另外一件很长的事情。',
      target: 'as well as',
      localEntry: phrase,
    }), false)
    assert.equal(canPromoteMisclassifiedPhrase({
      type: 'sentence',
      sourceText: '这是一个完整句子没有标点但是不该拿单词资料',
      target: 'parallel',
      localEntry: localEntry(),
    }), false)
  })

  await t.test('例句最多挂两条，不把独立例句数组错配成无限义项', () => {
    const attached = attachDefinitionExamples(
      [{ pos: 'n.', meaning: 'a line' }, { pos: 'adj.', meaning: 'side by side' }, { pos: 'v.', meaning: 'to match' }],
      ['one', 'two', 'three'],
    )
    assert.deepEqual(attached.map(item => item.example), ['one', 'two', ''])
  })

  await t.test('预算到期只保留已确认字段', () => {
    assert.deepEqual(dictionaryStatusAfterBudget({
      showPhonetic: true,
      showDefinitions: true,
      result: { phonetic: '/x/', phoneticRegion: 'UK', definitions: [{ meaning: '平行的' }] },
      lang: 'en',
    }), { phonetic: 'unavailable', definitions: 'available' })
  })
})

test('字段有效性：方向、美式与音标形状', async (t) => {
  await t.test('音标必须是有结构的 IPA 文本', () => {
    assert.equal(hasUsablePhonetic('/ˈpæɹəˌlɛl/'), true)
    assert.equal(hasUsablePhonetic('[ˈpæɹəˌlɛl]'), true)
    assert.equal(hasUsablePhonetic(''), false)
    assert.equal(hasUsablePhonetic('pronounced like parallel'), false)
    assert.equal(hasUsablePhonetic('a'.repeat(61)), false)
  })

  await t.test('英译中只接受中文释义，中译英只接受英文释义', () => {
    assert.equal(hasUsableDefinitions([{ pos: 'adj.', meaning: '平行的' }], 'en'), true)
    assert.equal(hasUsableDefinitions([{ pos: 'adj.', meaning: 'parallel; equal' }], 'en'), false)
    assert.equal(hasUsableDefinitions([{ pos: 'adj.', meaning: 'parallel; equal' }], 'zh'), true)
    assert.equal(hasUsableDefinitions([{ pos: 'adj.', meaning: '平行的' }], 'zh'), false)
    assert.equal(hasUsableDefinitions([], 'en'), false)
  })

  await t.test('本地词库按方向取释义；音标只在来源标注 US 时可用', () => {
    assert.deepEqual(pickLocalDefinitions(localEntry(), 'en'), [{ pos: 'adj.', meaning: '平行的' }])
    assert.deepEqual(pickLocalDefinitions(localEntry(), 'zh'), [{ pos: 'adj.', meaning: 'equally distant from one another' }])
    assert.equal(pickLocalPhonetic(localEntry()), '/ˈpæɹəˌlɛl/')
    assert.equal(pickLocalPhonetic(localEntry({ phonetic: { value: '/ˈpærəlɛl/', region: 'UK' } })), '')
    assert.equal(pickLocalPhonetic(localEntry({ phonetic: { value: '/ˈpærəlɛl/', region: '' } })), '')
  })
})

test('补全总预算的等待语义', async (t) => {
  await t.test('到期立即以 null 结算，晚到结果不再回填', async () => {
    let late = false
    const slow = new Promise((resolve) => setTimeout(() => { late = true; resolve({ found: true }) }, 120))
    const t0 = Date.now()
    const value = await waitWithBudget(slow, 40)
    const elapsed = Date.now() - t0
    assert.equal(value, null)
    assert.ok(elapsed < 100, `应在上限附近结算，实际 ${elapsed}ms`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(late, true) // 底层调用仍在进行，但结果已被丢弃
  })

  await t.test('预算内返回的结果原样透传；拒绝与缺参数都安全降级', async () => {
    assert.deepEqual(await waitWithBudget(Promise.resolve({ found: true }), 100), { found: true })
    assert.equal(await waitWithBudget(Promise.reject(new Error('boom')), 100), null)
    assert.equal(await waitWithBudget(new Promise(() => {}), 20), null)
  })
})

test('字段级合并与陈旧防护', async (t) => {
  await t.test('只补缺失字段，不覆盖主译文，也不重名 AI 名称', () => {
    const result = { translation: '平行的', definitions: [], examples: [] }
    const merged = mergeDictionarySupplement({
      result,
      localEntry: localEntry(),
      onlineEntry: null,
      lang: 'en',
    })
    assert.equal(merged.result.translation, '平行的')
    assert.equal(merged.result.phonetic, '/ˈpæɹəˌlɛl/')
    assert.deepEqual(merged.result.definitions, [{ pos: 'adj.', meaning: '平行的' }])
  })

  await t.test('英译中不使用在线英文释义充当中文含义', () => {
    const merged = mergeDictionarySupplement({
      result: { translation: '平行的' },
      localEntry: null,
      onlineEntry: { phonetic: '', definitions: [{ pos: 'adjective', meaning: 'equally distant' }], examples: [] },
      lang: 'en',
    })
    assert.deepEqual(merged.result.definitions, undefined)
  })

  await t.test('词性按明确映射规范化，无法映射则不造标签', () => {
    assert.equal(normalizePartOfSpeech('noun'), 'n.')
    assert.equal(normalizePartOfSpeech('Adjective'), 'adj.')
    assert.equal(normalizePartOfSpeech('auxiliary verb'), 'aux.')
    assert.equal(normalizePartOfSpeech('prepositional phrase'), 'phr.')
    assert.equal(normalizePartOfSpeech('adj.'), 'adj.')
    assert.equal(normalizePartOfSpeech('名詞'), '')
    assert.equal(normalizePartOfSpeech(''), '')
  })

  await t.test('在线英文释义的词性全称被规范化为缩写', () => {
    const merged = mergeDictionarySupplement({
      result: { translation: 'parallel' },
      localEntry: null,
      onlineEntry: { phonetic: '', definitions: [{ pos: 'noun', meaning: 'a line that never meets another' }], examples: [] },
      lang: 'zh',
    })
    assert.deepEqual(merged.result.definitions, [{ pos: 'n.', meaning: 'a line that never meets another' }])
  })

  await t.test('中译英可用在线英文释义补缺', () => {
    const merged = mergeDictionarySupplement({
      result: { translation: 'parallel' },
      localEntry: null,
      onlineEntry: { phonetic: '', definitions: [{ pos: 'noun', meaning: 'a line that never meets another' }], examples: [] },
      lang: 'zh',
    })
    assert.deepEqual(merged.result.definitions, [{ pos: 'n.', meaning: 'a line that never meets another' }])
  })

  await t.test('无法确认口音的音标不阻止本地美式补全，也不得当作合格音标留下', async () => {
    const replaced = mergeDictionarySupplement({
      result: { translation: '平行', phonetic: '/keep/' },
      localEntry: localEntry({ phonetic: { value: '/other/', region: 'US' } }),
      onlineEntry: { phonetic: '/online/', definitions: [], examples: [] },
      lang: 'en',
    })
    assert.equal(replaced.result.phonetic, '/other/')
    assert.equal(replaced.result.phoneticRegion, 'US')

    const confirmed = mergeDictionarySupplement({
      result: { translation: '平行', phonetic: '/keep/', phoneticRegion: 'US' },
      localEntry: localEntry({ phonetic: { value: '/other/', region: 'US' } }),
      onlineEntry: null,
      lang: 'en',
    })
    assert.equal(confirmed.result.phonetic, '/keep/')

    const unconfirmedOnly = mergeDictionarySupplement({
      result: { translation: '平行', phonetic: '/brɪtɪʃ/' },
      localEntry: localEntry({ phonetic: { value: '/ˈpærəlɛl/', region: 'UK' } }),
      onlineEntry: { phonetic: '/online/', definitions: [], examples: [] },
      lang: 'en',
    })
    assert.equal(unconfirmedOnly.result.phonetic, '')

    const onlyBritish = mergeDictionarySupplement({
      result: { translation: '平行' },
      localEntry: localEntry({ phonetic: { value: '/ˈpærəlɛl/', region: 'UK' } }),
      onlineEntry: { phonetic: '/online/', definitions: [], examples: [] },
      lang: 'en',
    })
    assert.equal(onlyBritish.result.phonetic, undefined)

    const services = { lookupWord: async () => ({ phonetic: '/online/', definitions: [], examples: [] }) }
    const online = await safeLookupWord('parallel', { services })
    assert.equal(online.phonetic, '')
  })

  await t.test('错误语言的释义不得阻止方向正确的本地补全', () => {
    const mixed = mergeDictionarySupplement({
      result: {
        translation: '平行的',
        definitions: [
          { pos: 'adj.', meaning: 'equally distant' },
          { pos: 'adj.', meaning: '平行的' },
        ],
      },
      localEntry: localEntry({
        definitions: {
          zh: [{ pos: 'adj.', meaning: '平行的' }, { pos: 'n.', meaning: '相似之处' }],
          en: [],
        },
      }),
      onlineEntry: null,
      lang: 'en',
    })
    assert.deepEqual(mixed.result.definitions, [
      { pos: 'adj.', meaning: '平行的' },
    ])
    assert.equal(
      mixed.result.definitions.some(item => item.meaning === 'equally distant'),
      false,
    )

    const allWrong = mergeDictionarySupplement({
      result: {
        translation: '平行的',
        definitions: [{ pos: 'adj.', meaning: 'equally distant' }],
      },
      localEntry: localEntry(),
      onlineEntry: null,
      lang: 'en',
    })
    assert.deepEqual(allWrong.result.definitions, [{ pos: 'adj.', meaning: '平行的' }])
  })

  await t.test('词组不通过在线单词词典查询', async () => {
    let called = 0
    const services = { lookupWord: async () => { called += 1; return { phonetic: '', definitions: [], examples: [] } } }
    await safeLookupWord('as well as', { services })
    assert.equal(called, 0)
  })

  await t.test('输入快照或语言方向变化时拒绝合并', () => {
    const base = {
      engine: 'baidu',
      usedEngine: 'baidu',
      translation: '平行的',
      currentTranslation: '平行的',
      isCurrent: () => true,
      sourceText: 'parallel',
      currentSourceText: 'parallel',
      lang: 'en',
      currentLang: 'en',
    }
    assert.equal(canApplyDictionarySupplement(base), true)
    assert.equal(canApplyDictionarySupplement({ ...base, currentSourceText: 'another word' }), false)
    assert.equal(canApplyDictionarySupplement({ ...base, currentLang: 'zh' }), false)
    assert.equal(canApplyDictionarySupplement({ ...base, currentTranslation: '新的' }), false)
  })
})

test('本地词库访问与降级', async (t) => {
  await t.test('桥接缺失返回 null，不抛错', async () => {
    assert.equal(await safeLookupLocalDictionary('parallel', { services: {} }), null)
  })

  await t.test('按变体依次查询，命中即返回', async () => {
    const seen = []
    const env = {
      services: {
        lookupLocalDictionary: async (key) => {
          seen.push(key)
          return key === 'e-mail' ? localEntry({ key }) : { found: false }
        },
      },
    }
    const hit = await safeLookupLocalDictionary('E-Mail', env)
    assert.equal(hit.key, 'e-mail')
    assert.deepEqual(seen, ['e-mail'])
  })

  await t.test('查询抛错时返回 null', async () => {
    const env = { services: { lookupLocalDictionary: async () => { throw new Error('beat') } } }
    assert.equal(await safeLookupLocalDictionary('parallel', env), null)
  })
})
