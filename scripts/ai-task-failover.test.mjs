import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runAiTaskFailover, AI_TASK_SOURCES } from '../src/Translate/utils/aiTaskFailover.js'
import { normalizeDetectionCode } from '../src/Translate/prompts/languageDetection.js'
import { normalizePolishText } from '../src/Translate/prompts/polish.js'
import { SKIP_REASON, SKIP_CATEGORY } from '../src/Translate/utils/engineBridge.js'
import { normalizeEngineEnabled, KNOWN_ENGINES } from '../src/Translate/utils/engineAvailability.js'

const VALIDATE_CODE = (raw) => {
  const code = normalizeDetectionCode(raw)
  return code ? { ok: true, value: code } : { ok: false }
}

const VALIDATE_POLISH = (raw) => {
  const text = normalizePolishText(raw)
  return text ? { ok: true, value: text } : { ok: false }
}

function settingsWith(overrides = {}) {
  return {
    engineEnabled: normalizeEngineEnabled(overrides.engineEnabled),
    failoverOrder: overrides.failoverOrder || [...KNOWN_ENGINES],
    thirdpartyAiGroups: overrides.thirdpartyAiGroups || [],
    thirdpartyAiFailoverTimeoutSeconds: overrides.thirdpartyAiFailoverTimeoutSeconds,
  }
}

const GROUP_A = { id: 'g_a', name: 'A', url: 'https://a.example/v1', apiKey: 'sk-a', model: 'm' }
const GROUP_B = { id: 'g_b', name: 'B', url: 'https://b.example/v1', apiKey: 'sk-b', model: 'm' }

function hang() {
  return new Promise(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('normalizeDetectionCode', () => {
  it('只接受规范化后精确的 zh / en', () => {
    assert.equal(normalizeDetectionCode('zh'), 'zh')
    assert.equal(normalizeDetectionCode('  EN \n'), 'en')
    assert.equal(normalizeDetectionCode('```\nzh\n```'), 'zh')
    assert.equal(normalizeDetectionCode('```text\nen\n```'), 'en')
    assert.equal(normalizeDetectionCode('maybe zh or en'), '')
    assert.equal(normalizeDetectionCode('中文'), '')
    assert.equal(normalizeDetectionCode(''), '')
    assert.equal(normalizeDetectionCode('语言是 zh 的概率很高'), '')
  })
})

describe('normalizePolishText', () => {
  it('非字符串响应不得被强转成伪造的润色文本', () => {
    for (const value of [{ text: 'not text' }, ['not text'], 123, true]) {
      assert.equal(normalizePolishText(value), '')
    }
  })

  it('清理 markdown 包裹后返回非空文本，空内容视为无效', () => {
    assert.equal(normalizePolishText('  Refined text. '), 'Refined text.')
    assert.equal(normalizePolishText('```\nRefined.\n```'), 'Refined.')
    assert.equal(normalizePolishText('```markdown\nRefined.\n```'), 'Refined.')
    assert.equal(normalizePolishText('```\n```'), '')
    assert.equal(normalizePolishText(''), '')
  })
})

describe('runAiTaskFailover 来源顺序与首个有效结果', () => {
  it('按有效顺序调用，首个有效结果立即结束且不再调用后续来源', async () => {
    const calls = []
    const env = {
      utools: { ai: async () => { calls.push('ai'); return { content: 'en' } } },
      services: { requestThirdpartyAI: async () => { calls.push('thirdparty'); return { choices: [{ message: { content: 'zh' } }] } } },
    }
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.success, true)
    assert.equal(out.value, 'en')
    assert.equal(out.source, 'ai')
    assert.deepEqual(calls, ['ai'])
  })

  it('交换顺序后首选不同来源', async () => {
    const calls = []
    const env = {
      utools: { ai: async () => { calls.push('ai'); return { content: 'en' } } },
      services: { requestThirdpartyAI: async () => { calls.push('thirdparty'); return { choices: [{ message: { content: 'zh' } }] } } },
    }
    const out = await runAiTaskFailover({
      sources: ['thirdparty-ai', 'ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.value, 'zh')
    assert.equal(out.source, 'thirdparty-ai')
    assert.deepEqual(calls, ['thirdparty'])
  })

  it('关闭来源被过滤：不调用关闭的 uTools AI，仅用自定义 AI', async () => {
    const calls = []
    const engineEnabled = normalizeEngineEnabled({ ai: false })
    const env = {
      utools: { ai: async () => { calls.push('ai'); return { content: 'en' } } },
      services: { requestThirdpartyAI: async () => { calls.push('thirdparty'); return { choices: [{ message: { content: 'zh' } }] } } },
    }
    const out = await runAiTaskFailover({
      sources: AI_TASK_SOURCES,
      settings: settingsWith({ engineEnabled, thirdpartyAiGroups: [GROUP_A] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.success, true)
    assert.deepEqual(calls, ['thirdparty'])
  })

  it('无效格式、空内容与异常继续下一来源；仅首个有效结果被采用', async () => {
    const env = {
      utools: { ai: async () => ({ content: 'maybe zh or en' }) },
      services: { requestThirdpartyAI: async () => ({ choices: [{ message: { content: '' } }] }) },
    }
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A, GROUP_B] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.success, false)
    assert.ok(out.outcomes.every(o => o.status !== 'success'))
  })

  it('全部耗尽时返回 success=false，不抛错', async () => {
    const env = { utools: undefined, services: undefined }
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.success, false)
    assert.ok(out.outcomes.some(o => o.status === 'skipped' && o.skipReason === SKIP_REASON.METHOD_MISSING))
  })

  it('未配置自定义 AI 组按配置跳过且不发请求', async () => {
    let calls = 0
    const env = {
      utools: { ai: async () => ({ content: 'en' }) },
      services: { requestThirdpartyAI: async () => { calls += 1; return {} } },
    }
    const out = await runAiTaskFailover({
      sources: ['thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [{ id: 'g_empty', name: '', url: '', apiKey: '', model: '' }] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      env,
    })
    assert.equal(out.success, false)
    assert.equal(calls, 0)
    assert.ok(out.outcomes.some(o => o.status === 'skipped' && o.skipCategory === SKIP_CATEGORY.CONFIG))
  })
})

describe('runAiTaskFailover 时限', () => {
  it('uTools AI 超时后继续自定义 AI，迟到结果不覆盖', async () => {
    const t0 = Date.now()
    const env = {
      utools: { ai: () => hang() },
      services: { requestThirdpartyAI: async () => delay(10).then(() => ({ choices: [{ message: { content: 'zh' } }] })) },
    }
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      timeoutMs: 30,
      groupTimeoutMs: 200,
      env,
    })
    const elapsed = Date.now() - t0
    assert.equal(out.success, true)
    assert.equal(out.value, 'zh')
    assert.ok(elapsed >= 25 && elapsed < 150, `elapsed=${elapsed}`)
  })

  it('自定义 AI 组链不被一级时限截断：首组挂起用尽组时限，次组仍需完整预算', async () => {
    const evicted = []
    const env = {
      utools: { ai: async () => ({ content: 'en' }) },
      services: {
        requestThirdpartyAI: async (url) => {
          evicted.push(url)
          if (url === GROUP_A.url) return hang()
          return delay(20).then(() => ({ choices: [{ message: { content: 'zh' } }] }))
        },
      },
    }
    const t0 = Date.now()
    const out = await runAiTaskFailover({
      sources: ['thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A, GROUP_B] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      timeoutMs: 20,       // 一级时限远小于组链
      groupTimeoutMs: 60,  // 每组独立时限
      env,
    })
    const elapsed = Date.now() - t0
    assert.equal(out.success, true)
    assert.equal(out.value, 'zh')
    assert.deepEqual(evicted, [GROUP_A.url, GROUP_B.url])
    // 首组吃满 60ms，次组 20ms；总耗时远超一级 20ms
    assert.ok(elapsed >= 70, `elapsed=${elapsed}`)
  })

  it('isCurrent 失效后立即按 stale 结算，不再尝试后续来源', async () => {
    let current = true
    const calls = []
    const env = {
      utools: { ai: () => { current = false; return hang() } },
      services: { requestThirdpartyAI: async () => { calls.push('tp'); return { choices: [{ message: { content: 'zh' } }] } } },
    }
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A] }),
      messages: [{ role: 'user', content: 'x' }],
      validate: VALIDATE_CODE,
      timeoutMs: 30,
      env,
      isCurrent: () => current,
    })
    assert.equal(out.stale, true)
    assert.deepEqual(calls, [])
  })
})

describe('runAiTaskFailover 无效润色响应', () => {
  it('对象或数组正文继续下一来源/组，而非提前宣告成功', async () => {
    let calls = 0
    const out = await runAiTaskFailover({
      sources: ['ai', 'thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A, GROUP_B] }),
      validate: VALIDATE_POLISH,
      messages: [{ role: 'user', content: 'fixture' }],
      env: {
        utools: { ai: async () => ({ content: { text: 'invalid' } }) },
        services: { requestThirdpartyAI: async () => ({ choices: [{ message: { content: ++calls === 1 ? ['invalid'] : 'Valid text.' } }] }) },
      },
    })
    assert.equal(out.success, true)
    assert.equal(out.value, 'Valid text.')
    assert.equal(calls, 2)
  })
})

describe('runAiTaskFailover 消息边界', () => {
  it('透传调用方消息，不附加自定义翻译系统提示词', async () => {
    let seen = null
    const env = {
      utools: undefined,
      services: { requestThirdpartyAI: async (url, key, body) => { seen = body; return { choices: [{ message: { content: 'Refined.' } }] } } },
    }
    const messages = [{ role: 'user', content: 'polish this' }]
    const out = await runAiTaskFailover({
      sources: ['thirdparty-ai'],
      settings: settingsWith({ thirdpartyAiGroups: [GROUP_A] }),
      messages,
      validate: VALIDATE_POLISH,
      env,
    })
    assert.equal(out.success, true)
    assert.deepEqual(seen.messages, messages)
    assert.equal(seen.stream, false)
    assert.equal(seen.model, 'm')
  })
})
