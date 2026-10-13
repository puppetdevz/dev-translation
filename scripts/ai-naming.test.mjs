import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_NAMING_STATUS,
  AI_NAMING_TOTAL_BUDGET_MS,
  AI_NAMING_UNCONFIGURED_MESSAGE,
  countUnicodeCodePoints,
  exceedsAiNamingInputLimit,
  filterAiNamingSources,
  parseNamingResponse,
  runAiNaming,
  sanitizeNamingWords,
} from '../src/Translate/utils/aiNaming.js'

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const hang = () => new Promise(() => {})

const GROUP = {
  id: 'g_a',
  name: '自定义 AI 1',
  url: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'm',
}

function utoolsEnv(ai) {
  return { utools: { ai }, services: { requestThirdpartyAI: async () => ({}) } }
}

function groupEnv(requestThirdpartyAI) {
  return { utools: {}, services: { requestThirdpartyAI } }
}

test('AI 命名字段与边界', async (t) => {
  await t.test('输入长度按 Unicode 码点计数，200/201 为边界', () => {
    assert.equal(AI_NAMING_TOTAL_BUDGET_MS, 10000)
    assert.equal(countUnicodeCodePoints('😀'), 1)
    assert.equal(countUnicodeCodePoints('a😀'), 2)
    assert.equal(exceedsAiNamingInputLimit('a'.repeat(200)), false)
    assert.equal(exceedsAiNamingInputLimit(`  ${'a'.repeat(200)}  `), false)
    assert.equal(exceedsAiNamingInputLimit('a'.repeat(201)), true)
    assert.equal(exceedsAiNamingInputLimit(`${'a'.repeat(200)}😀`), true)
  })

  await t.test('来源只保留顺序中的 AI 来源', () => {
    assert.deepEqual(
      filterAiNamingSources(['baidu', 'thirdparty-ai', 'ai', 'google', 'deepl']),
      ['thirdparty-ai', 'ai'],
    )
    assert.deepEqual(filterAiNamingSources(['google', 'baidu']), [])
    assert.deepEqual(filterAiNamingSources(undefined), [])
  })

  await t.test('词元严格校验：中英文界限、标点、数量与去重', () => {
    assert.deepEqual(sanitizeNamingWords(['Discovery', 'count']), ['discovery', 'count'])
    assert.deepEqual(sanitizeNamingWords(['is', 'loaded']), ['is', 'loaded'])
    assert.deepEqual(sanitizeNamingWords([]), [])
    assert.deepEqual(sanitizeNamingWords(['发现']), [])
    assert.deepEqual(sanitizeNamingWords(['discovery-count']), [])
    assert.deepEqual(sanitizeNamingWords(['discovery', '']), [])
    assert.deepEqual(sanitizeNamingWords(['discovery', { word: 'count' }]), [])
    assert.deepEqual(sanitizeNamingWords(['a', 'b', 'c', 'd', 'e']), [])
  })

  await t.test('容错提取 JSON 后仍严格校验结构', () => {
    assert.deepEqual(parseNamingResponse('{"shouldName":true,"words":["discovery","count"]}'), {
      ok: true, shouldName: true, words: ['discovery', 'count'],
    })
    assert.deepEqual(parseNamingResponse('```json\n{"shouldName":false,"words":[]}\n```'), {
      ok: true, shouldName: false, words: [],
    })
    assert.deepEqual(parseNamingResponse('说明：{"shouldName":true,"words":["is","loaded"]} 结束'), {
      ok: true, shouldName: true, words: ['is', 'loaded'],
    })
    assert.equal(parseNamingResponse('not json').ok, false)
    assert.equal(parseNamingResponse('{"shouldName":"true","words":["a"]}').ok, false)
    assert.equal(parseNamingResponse('{"shouldName":true,"words":[]}').ok, false)
    assert.equal(parseNamingResponse('{"shouldName":true,"words":["乱码"]}').ok, false)
    assert.equal(parseNamingResponse('{"translation":"hello"}').ok, false)
  })
})

test('AI 命名调度与总预算', async (t) => {
  await t.test('无可用来源返回 unconfigured 且不请求', async () => {
    let called = 0
    const result = await runAiNaming({
      sources: [],
      settings: {},
      messages: [],
      env: { utools: {}, services: { requestThirdpartyAI: async () => { called += 1 } } },
    })
    assert.equal(result.status, AI_NAMING_STATUS.UNCONFIGURED)
    assert.equal(result.message, AI_NAMING_UNCONFIGURED_MESSAGE)
    assert.equal(called, 0)
  })

  await t.test('桥接缺失时提示重载而非「未配置」', async () => {
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: { thirdpartyAiGroups: [GROUP] },
      messages: [],
      env: { utools: {}, services: {} },
    })
    assert.equal(result.status, AI_NAMING_STATUS.UNCONFIGURED)
    assert.match(result.message, /翻译服务未加载/)
  })

  await t.test('自定义 AI 组缺字段时跳过，不发起请求', async () => {
    let called = 0
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: { thirdpartyAiGroups: [{ id: 'g_x', name: 'g', url: '', apiKey: '', model: '' }] },
      messages: [],
      env: groupEnv(async () => { called += 1 }),
    })
    assert.equal(result.status, AI_NAMING_STATUS.UNCONFIGURED)
    assert.equal(called, 0)
  })

  await t.test('宿主 AI 返回 shouldName=false 时视为有效结果且不回退', async () => {
    let groupCalls = 0
    const result = await runAiNaming({
      sources: ['ai', 'thirdparty-ai'],
      settings: { thirdpartyAiGroups: [GROUP] },
      messages: [],
      env: {
        utools: { ai: async () => ({ content: '{"shouldName":false,"words":[]}' }) },
        services: { requestThirdpartyAI: async () => { groupCalls += 1 } },
      },
    })
    assert.equal(result.status, AI_NAMING_STATUS.NONE)
    assert.deepEqual(result.words, [])
    assert.equal(groupCalls, 0)
  })

  await t.test('首来源无效 JSON 时在剩余预算内回退到下一组', async () => {
    const seen = []
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: { thirdpartyAiGroups: [{ ...GROUP, id: 'g_bad' }, { ...GROUP, id: 'g_good' }] },
      messages: [],
      budgetMs: 2000,
      groupTimeoutMs: 2000,
      env: groupEnv(async (url, key, body, timeoutMs) => {
        seen.push(body.model)
        void url; void key; void timeoutMs
        return { choices: [{ message: { content: '{"translation":"hi"}' } }] }
      }),
    })
    // 两组都返回无效结构，全部有效尝试失败
    assert.equal(seen.length, 2)
    assert.equal(result.status, AI_NAMING_STATUS.FAILED)
  })

  await t.test('无效结果后合格来源成功，返回一个语义名称', async () => {
    let index = 0
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: { thirdpartyAiGroups: [{ ...GROUP, id: 'g_1' }, { ...GROUP, id: 'g_2' }] },
      messages: [],
      budgetMs: 3000,
      groupTimeoutMs: 3000,
      env: groupEnv(async () => {
        index += 1
        if (index === 1) return { choices: [{ message: { content: '这里没有 JSON' } }] }
        return { choices: [{ message: { content: '{"shouldName":true,"words":["discovery","count"]}' } }] }
      }),
    })
    assert.equal(result.status, AI_NAMING_STATUS.READY)
    assert.deepEqual(result.words, ['discovery', 'count'])
  })

  await t.test('单次调用时限不超过剩余总预算，超时后不再请求并返回 timeout', async () => {
    const timeouts = []
    const t0 = Date.now()
    const result = await runAiNaming({
      sources: ['thirdparty-ai'],
      settings: { thirdpartyAiGroups: [{ ...GROUP, id: 'g_1' }, { ...GROUP, id: 'g_2' }, { ...GROUP, id: 'g_3' }] },
      messages: [],
      budgetMs: 260,
      groupTimeoutMs: 30000, // 组时限远大于总预算：必须被剩余预算截断
      env: groupEnv(async (url, key, body, timeoutMs) => {
        timeouts.push(timeoutMs)
        void url; void key; void body
        return hang()
      }),
    })
    const elapsed = Date.now() - t0
    assert.equal(result.status, AI_NAMING_STATUS.TIMEOUT)
    assert.ok(elapsed < 900, `总预算应限制整体耗时，实际 ${elapsed}ms`)
    assert.ok(timeouts.length >= 1)
    for (const value of timeouts) {
      assert.ok(value <= 260, `单次预算应被总预算收紧，实际 ${value}`)
    }
    assert.ok(timeouts[0] > 0)
  })

  await t.test('isCurrent 失效时丢弃晚到结果', async () => {
    let current = true
    const promise = runAiNaming({
      sources: ['ai'],
      messages: [],
      env: utoolsEnv(async () => {
        await delay(30)
        current = false
        return { content: '{"shouldName":true,"words":["late"]}' }
      }),
      isCurrent: () => current,
    })
    const result = await promise
    assert.equal(result.status, AI_NAMING_STATUS.STALE)
    assert.deepEqual(result.words, [])
  })
})
