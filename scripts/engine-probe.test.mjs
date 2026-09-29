import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { SKIP_REASON, SKIP_CATEGORY, ERROR_CATEGORY } from '../src/Translate/utils/engineBridge.js'
import { KNOWN_ENGINES } from '../src/Translate/utils/storage.js'

const store = {}
globalThis.window = {
  utools: {
    dbStorage: {
      getItem(key) { return store[key] ?? null },
      setItem(key, value) { store[key] = value },
    },
  },
}

const {
  createProbeText,
  resolveProbeEngines,
  snapshotProbeConfig,
  isProbeConfigUnchanged,
  sortByProbeResults,
  applyProbeOrder,
  createProbeRunGuard,
  inspectProbeEngines,
  runBatchEngineProbe,
  callEngineProbe,
  formatProbeItemText,
  PROBE_APPLY,
  PROBE_NO_SUCCESS_MESSAGE,
} = await import('../src/Translate/utils/engineProbe.js')

const {
  recordEngineResult,
  getEngineStat,
} = await import('../src/Translate/utils/engineStats.js')

function hang() {
  return new Promise(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const CONFIGURED = {
  failoverOrder: ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx'],
  engineResponseTimeoutSeconds: 5,
  deeplApiKey: 'k',
  deeplxServerUrl: 'http://localhost:1188',
  deeplxToken: 'tok',
  thirdpartyAiUrl: 'https://api.example.com/v1',
  thirdpartyAiKey: 'sk-secret',
  thirdpartyAiModel: 'm',
}

const PRELOAD_SERVICES = {
  googleTranslate: async () => 'ok',
  deeplTranslate: async () => 'ok',
  deeplxTranslate: async () => 'ok',
  requestThirdpartyAI: async () => ({ choices: [{ message: { content: 'ok' } }] }),
}

const READY_ENV = {
  services: PRELOAD_SERVICES,
  utools: { ai: async () => ({ content: 'ok' }) },
}

describe('createProbeText', () => {
  it('每轮短英文带变化标记，且两轮文本不同', () => {
    const a = createProbeText(1, 0.11)
    const b = createProbeText(2, 0.99)
    assert.equal(typeof a, 'string')
    assert.match(a, /Hello World/)
    assert.notEqual(a, 'Hello World')
    assert.notEqual(a, b)
    assert.notEqual(createProbeText(1, 0.11), a, '同毫秒及相同随机值也不得复用旧文本')
    assert.equal(a.includes('http'), false)
    assert.equal(a.includes('sk-'), false)
  })
})

describe('resolveProbeEngines', () => {
  it('始终覆盖五个已知引擎，缺项按 KNOWN_ENGINES 补在尾部', () => {
    assert.deepEqual(resolveProbeEngines(['google']), ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'])
    assert.deepEqual(resolveProbeEngines(KNOWN_ENGINES), KNOWN_ENGINES)
    assert.deepEqual(resolveProbeEngines(['deepl', 'ai', 'unknown']), ['deepl', 'ai', 'thirdparty-ai', 'google', 'deeplx'])
    assert.deepEqual(resolveProbeEngines(null), [...KNOWN_ENGINES])
  })
})

describe('sortByProbeResults', () => {
  it('成功按耗时升序，失败在成功之后，跳过最后；同组保持原相对次序', () => {
    const original = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx']
    const results = [
      { engine: 'ai', status: 'failure', durationMs: 9 },
      { engine: 'thirdparty-ai', status: 'skipped' },
      { engine: 'google', status: 'success', durationMs: 40 },
      { engine: 'deepl', status: 'success', durationMs: 10 },
      { engine: 'deeplx', status: 'failure', durationMs: 80 },
    ]
    assert.deepEqual(
      sortByProbeResults(original, results),
      ['deepl', 'google', 'ai', 'deeplx', 'thirdparty-ai']
    )
  })

  it('成功组耗时相同者保持原 failoverOrder 相对次序', () => {
    const original = ['deepl', 'google', 'ai']
    const results = [
      { engine: 'deepl', status: 'success', durationMs: 10 },
      { engine: 'google', status: 'success', durationMs: 10 },
      { engine: 'ai', status: 'success', durationMs: 10 },
    ]
    assert.deepEqual(
      sortByProbeResults(original, results),
      ['deepl', 'google', 'ai', 'thirdparty-ai', 'deeplx']
    )
  })

  it('无成功时调用方应保持原顺序，排序函数不得丢失或重复引擎', () => {
    const original = ['deeplx', 'ai', 'google']
    const results = [
      { engine: 'deeplx', status: 'failure' },
      { engine: 'ai', status: 'skipped' },
      { engine: 'google', status: 'failure' },
    ]
    const sorted = sortByProbeResults(original, results)
    assert.equal(new Set(sorted).size, sorted.length)
    assert.ok(KNOWN_ENGINES.every(e => sorted.includes(e)))
  })
})

describe('snapshotProbeConfig / isProbeConfigUnchanged', () => {
  it('顺序、超时或引擎配置任一变化即视为已改动', () => {
    const snap = snapshotProbeConfig(CONFIGURED)
    assert.equal(isProbeConfigUnchanged(snap, CONFIGURED), true)
    assert.equal(isProbeConfigUnchanged(snap, { ...CONFIGURED, deeplApiKey: 'other' }), false)
    assert.equal(isProbeConfigUnchanged(snap, { ...CONFIGURED, thirdpartyAiSystemPrompt: 'changed' }), false)
    assert.equal(isProbeConfigUnchanged(snap, { ...CONFIGURED, engineResponseTimeoutSeconds: 1 }), false)
    assert.equal(isProbeConfigUnchanged(snap, {
      ...CONFIGURED,
      failoverOrder: ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'],
    }), false)
  })
})

describe('applyProbeOrder', () => {
  it('至少一个成功且未失效时写入新顺序', () => {
    let saved = null
    const out = applyProbeOrder({
      hadSuccess: true,
      stale: false,
      leftPage: false,
      nextOrder: ['google', 'ai'],
      persistOrder: (order) => { saved = order; return true },
    })
    assert.equal(out.applied, true)
    assert.equal(out.persisted, true)
    assert.equal(out.reason, PROBE_APPLY.OK)
    assert.deepEqual(saved, ['google', 'ai'])
  })

  it('本轮没有成功引擎时不保存任何新顺序', () => {
    let called = 0
    const out = applyProbeOrder({
      hadSuccess: false,
      stale: false,
      leftPage: false,
      nextOrder: ['google', 'ai'],
      persistOrder: () => { called += 1; return true },
    })
    assert.equal(out.applied, false)
    assert.equal(out.reason, PROBE_APPLY.NO_SUCCESS)
    assert.equal(called, 0)
  })

  it('配置/顺序变更或离页时不得用旧结果覆盖', () => {
    let called = 0
    const persist = () => { called += 1; return true }
    assert.equal(applyProbeOrder({
      hadSuccess: true, stale: true, leftPage: false, nextOrder: ['google'], persistOrder: persist,
    }).reason, PROBE_APPLY.STALE)
    assert.equal(applyProbeOrder({
      hadSuccess: true, stale: false, leftPage: true, nextOrder: ['google'], persistOrder: persist,
    }).reason, PROBE_APPLY.STALE)
    assert.equal(called, 0)
  })

  it('保存失败不得宣称已持久化', () => {
    const out = applyProbeOrder({
      hadSuccess: true,
      stale: false,
      leftPage: false,
      nextOrder: ['google'],
      persistOrder: () => false,
    })
    assert.equal(out.applied, true)
    assert.equal(out.persisted, false)
    assert.equal(out.reason, PROBE_APPLY.SAVE_FAILED)
  })
})

describe('createProbeRunGuard', () => {
  it('运行中拒绝启动第二轮，结束后可再测', () => {
    const guard = createProbeRunGuard()
    assert.equal(guard.tryStart(), true)
    assert.equal(guard.tryStart(), false)
    assert.equal(guard.running, true)
    guard.end()
    assert.equal(guard.tryStart(), true)
  })
})

describe('inspectProbeEngines', () => {
  it('未配置或缺桥接标记跳过且不进入 pending', () => {
    const items = inspectProbeEngines({ failoverOrder: KNOWN_ENGINES }, { services: undefined, utools: {} })
    assert.equal(items.length, 5)
    assert.ok(items.every(i => i.status === 'skipped'))
    assert.equal(items.find(i => i.engine === 'google').skipReason, SKIP_REASON.BRIDGE_MISSING)
    assert.equal(items.find(i => i.engine === 'ai').skipReason, SKIP_REASON.METHOD_MISSING)
  })
})

describe('runBatchEngineProbe', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('一次覆盖五个引擎：跳过不发请求，ready 各请求一次', async () => {
    const calls = []
    const settings = {
      ...CONFIGURED,
      deeplApiKey: '',
      failoverOrder: ['google', 'deepl', 'ai'],
    }
    const out = await runBatchEngineProbe({
      settings,
      env: READY_ENV,
      timeoutMs: 200,
      text: 'Hello World probe-1',
      translateWith: async (engine, text) => {
        calls.push({ engine, text })
        return { translation: `ok-${engine}` }
      },
    })
    assert.equal(out.results.length, 5)
    const byEngine = Object.fromEntries(out.results.map(r => [r.engine, r]))
    assert.equal(byEngine.deepl.status, 'skipped')
    assert.equal(byEngine.deepl.skipCategory, SKIP_CATEGORY.CONFIG)
    assert.deepEqual(calls.map(c => c.engine).sort(), ['ai', 'deeplx', 'google', 'thirdparty-ai'])
    assert.ok(calls.every(c => c.text === 'Hello World probe-1'))
    assert.equal(out.hadSuccess, true)
  })

  it('并行结算：挂起引擎不拖死其他项，整轮约一个时限结束', async () => {
    const calls = []
    const events = []
    const t0 = Date.now()
    const out = await runBatchEngineProbe({
      settings: CONFIGURED,
      env: READY_ENV,
      timeoutMs: 50,
      text: 'Hello World hang',
      onItem: (item) => events.push({ engine: item.engine, status: item.status, at: Date.now() }),
      translateWith: async (engine) => {
        calls.push(engine)
        if (engine === 'ai') return hang()
        return { translation: 'ok' }
      },
    })
    const elapsed = Date.now() - t0
    assert.equal(calls.length, 5)
    const byEngine = Object.fromEntries(out.results.map(r => [r.engine, r]))
    assert.equal(byEngine.ai.status, 'failure')
    assert.equal(byEngine.ai.category, ERROR_CATEGORY.TIMEOUT)
    assert.equal(byEngine.google.status, 'success')
    assert.ok(elapsed < 250, `应并行超时，实际 ${elapsed}ms`)
    assert.ok(elapsed >= 40, `应消耗独立时限，实际 ${elapsed}ms`)
    const googleEvent = events.find(e => e.engine === 'google')
    const aiEvent = events.find(e => e.engine === 'ai')
    assert.ok(googleEvent.at < aiEvent.at)
  })

  it('空译文与抛错记失败，安全文案不含原文/URL/凭据', async () => {
    const secret = 'Hello World secret-token https://api.example.com/v1?key=sk-live'
    const out = await runBatchEngineProbe({
      settings: CONFIGURED,
      env: READY_ENV,
      timeoutMs: 80,
      text: secret,
      translateWith: async (engine) => {
        if (engine === 'google') return { translation: '   ' }
        if (engine === 'ai') throw new Error(`HTTP 403 ${secret}`)
        if (engine === 'deepl') throw new Error('引擎请求超时')
        return { translation: '你好' }
      },
    })
    const byEngine = Object.fromEntries(out.results.map(r => [r.engine, r]))
    assert.equal(byEngine.google.status, 'failure')
    assert.equal(byEngine.google.category, ERROR_CATEGORY.EMPTY_RESULT)
    assert.equal(byEngine.ai.category, ERROR_CATEGORY.HTTP_ERROR)
    assert.equal(byEngine.deepl.category, ERROR_CATEGORY.TIMEOUT)
    for (const item of out.results) {
      const text = formatProbeItemText(item)
      assert.equal(String(text).includes('secret-token'), false)
      assert.equal(String(text).includes('sk-live'), false)
      assert.equal(String(text).includes('https://'), false)
      assert.equal(String(item.safeMessage || '').includes(secret), false)
      assert.equal(item.translation, undefined)
    }
  })

  it('迟到成功不得改写已超时的失败状态', async () => {
    let resolveLate
    const late = new Promise((resolve) => { resolveLate = resolve })
    const outPromise = runBatchEngineProbe({
      settings: { failoverOrder: ['google'] },
      env: READY_ENV,
      timeoutMs: 40,
      text: 'Hello World late',
      translateWith: async (engine) => {
        if (engine === 'google') {
          await late
          return { translation: 'too-late' }
        }
        return hang()
      },
    })
    const out = await outPromise
    const google = out.results.find(r => r.engine === 'google')
    assert.equal(google.status, 'failure')
    assert.equal(google.category, ERROR_CATEGORY.TIMEOUT)
    resolveLate()
    await delay(20)
    assert.equal(google.status, 'failure')
  })

  it('迟到拒绝被吞掉，不改写已超时结果', async () => {
    let rejectLate
    const late = new Promise((resolve, reject) => { rejectLate = reject })
    const out = await runBatchEngineProbe({
      settings: { ...CONFIGURED, deeplApiKey: '', deeplxServerUrl: '', thirdpartyAiUrl: '' },
      env: { services: PRELOAD_SERVICES, utools: {} },
      timeoutMs: 40,
      text: 'Hello World late reject',
      translateWith: (engine) => engine === 'google' ? late : hang(),
    })
    const item = out.results.find(r => r.engine === 'google')
    assert.equal(item.category, ERROR_CATEGORY.TIMEOUT)
    rejectLate(new Error('secret-token https://private.example.com'))
    await delay(20)
    assert.equal(item.category, ERROR_CATEGORY.TIMEOUT)
    assert.equal(item.safeMessage.includes('secret-token'), false)
  })

  it('无成功时 nextOrder 等于原顺序，即使列表缺项也不补全后保存', async () => {
    const original = ['google']
    const out = await runBatchEngineProbe({
      settings: { failoverOrder: original },
      env: { services: undefined, utools: {} },
      timeoutMs: 40,
      translateWith: async () => ({ translation: 'nope' }),
    })
    assert.equal(out.hadSuccess, false)
    assert.deepEqual(out.nextOrder, original)
    assert.equal(out.results.length, 5)
    assert.ok(out.results.every(r => r.status === 'skipped'))
  })

  it('测试途中改配置或拖拽后再拖回，旧轮不覆盖且请求始终用开始时快照', async () => {
    const current = { ...CONFIGURED, failoverOrder: [...CONFIGURED.failoverOrder] }
    const snapshot = snapshotProbeConfig(current)
    const calls = []
    let unblock
    const pending = new Promise(resolve => { unblock = resolve })
    const probe = runBatchEngineProbe({
      settings: snapshot,
      env: READY_ENV,
      timeoutMs: 100,
      text: 'Hello World snapshot',
      translateWith: async (engine, text, budget) => {
        calls.push({ engine, text, budget })
        await pending
        return { translation: '你好' }
      },
    })
    current.deeplApiKey = 'changed'
    current.failoverOrder = ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx']
    assert.equal(isProbeConfigUnchanged(snapshot, current), false)
    const stale = true // 模拟设置页在第一次修改时记录失效，即使随后恢复也不可应用
    current.deeplApiKey = CONFIGURED.deeplApiKey
    current.failoverOrder = [...CONFIGURED.failoverOrder]
    unblock()
    const out = await probe
    assert.equal(calls.length, 5)
    assert.ok(calls.every(call => call.text === 'Hello World snapshot' && call.budget === 100))
    assert.equal(snapshot.deeplApiKey, 'k')
    let saved = false
    const decision = applyProbeOrder({
      hadSuccess: out.hadSuccess,
      stale: stale || !isProbeConfigUnchanged(snapshot, current),
      leftPage: false,
      nextOrder: out.nextOrder,
      persistOrder: () => { saved = true; return true },
    })
    assert.equal(decision.reason, PROBE_APPLY.STALE)
    assert.equal(saved, false)
  })

  it('成功轮按耗时重排且不写入稳定性统计', async () => {
    recordEngineResult('google', true)
    const before = getEngineStat('google')
    const out = await runBatchEngineProbe({
      settings: CONFIGURED,
      env: READY_ENV,
      timeoutMs: 200,
      text: 'Hello World stats',
      translateWith: async (engine) => {
        if (engine === 'google') {
          await delay(5)
          return { translation: 'g' }
        }
        if (engine === 'ai') {
          await delay(40)
          return { translation: 'a' }
        }
        throw new Error('引擎返回空结果')
      },
    })
    assert.equal(out.hadSuccess, true)
    assert.equal(out.nextOrder[0], 'google')
    assert.ok(out.nextOrder.indexOf('google') < out.nextOrder.indexOf('ai'))
    assert.equal(getEngineStat('google').total, before.total)
    assert.equal(getEngineStat('google').success, before.success)
    assert.equal(getEngineStat('ai').total || 0, 0)
  })

  it('onItem 先报告跳过，再分别结算 ready 引擎', async () => {
    const events = []
    await runBatchEngineProbe({
      settings: { ...CONFIGURED, deeplApiKey: '', deeplxServerUrl: '' },
      env: READY_ENV,
      timeoutMs: 80,
      text: 'Hello World items',
      onItem: (item) => events.push(item.engine + ':' + item.status),
      translateWith: async () => ({ translation: 'ok' }),
    })
    assert.ok(events.indexOf('deepl:skipped') >= 0)
    assert.ok(events.indexOf('deeplx:skipped') >= 0)
    assert.ok(events.indexOf('deepl:skipped') < events.indexOf('google:success'))
  })
})

describe('callEngineProbe', () => {
  it('Google / DeepL / DeepLX / 第三方 AI 传入同一测试文本、中文目标和 timeoutMs', async () => {
    const captured = {}
    const text = 'Hello World round-x'
    const timeoutMs = 1234
    const env = {
      utools: {
        ai: async (payload) => {
          captured.ai = payload
          return { content: '你好' }
        },
      },
      services: {
        googleTranslate: async (t, from, to, ms) => {
          captured.google = { t, from, to, ms }
          return '你好'
        },
        deeplTranslate: async (t, from, to, key, ms) => {
          captured.deepl = { t, from, to, key, ms }
          return '你好'
        },
        deeplxTranslate: async (t, from, to, url, token, ms) => {
          captured.deeplx = { t, from, to, url, token, ms }
          return '你好'
        },
        requestThirdpartyAI: async (url, key, body, ms) => {
          captured.thirdparty = { url, key, body, ms }
          return { choices: [{ message: { content: '你好' } }] }
        },
      },
    }
    for (const engine of KNOWN_ENGINES) {
      const r = await callEngineProbe(engine, { text, settings: CONFIGURED, env, timeoutMs })
      assert.equal(r.translation.includes('你好'), true)
    }
    assert.equal(captured.google.t, text)
    assert.equal(captured.google.from, 'en')
    assert.equal(captured.google.to, 'zh-CN')
    assert.equal(captured.google.ms, timeoutMs)
    assert.equal(captured.deepl.ms, timeoutMs)
    assert.equal(captured.deepl.key, 'k')
    assert.equal(captured.deeplx.ms, timeoutMs)
    assert.equal(captured.deeplx.token, 'tok')
    assert.equal(captured.thirdparty.ms, timeoutMs)
    assert.equal(captured.thirdparty.body.model, 'm')
    assert.equal(captured.thirdparty.body.stream, false)
    assert.equal(captured.thirdparty.body.messages[0].content.includes(text), true)
    assert.equal(captured.thirdparty.key, 'sk-secret')
    assert.equal(captured.ai.messages[0].content.includes(text), true)
  })
})

describe('formatProbeItemText', () => {
  it('成功展示耗时，失败/跳过展示安全原因', () => {
    assert.match(formatProbeItemText({ status: 'success', durationMs: 86 }), /成功/)
    assert.match(formatProbeItemText({ status: 'success', durationMs: 86 }), /86/)
    assert.equal(formatProbeItemText({ status: 'pending' }), '测试中')
    assert.equal(
      formatProbeItemText({ status: 'failure', safeMessage: '引擎请求超时', category: ERROR_CATEGORY.TIMEOUT }),
      '引擎请求超时'
    )
    assert.equal(
      formatProbeItemText({ status: 'skipped', safeMessage: '引擎未配置必要凭据或地址' }),
      '引擎未配置必要凭据或地址'
    )
  })
})

describe('PROBE_NO_SUCCESS_MESSAGE', () => {
  it('全部未成功时的用户文案固定', () => {
    assert.equal(PROBE_NO_SUCCESS_MESSAGE, '无可用引擎，未调整顺序')
  })
})
