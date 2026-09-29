import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  inspectEngine,
  classifyError,
  runEngineFailover,
  buildAllFailedMessage,
  skipUserMessage,
  safeLookupWord,
  runMainTextTranslation,
  wordLookupTarget,
  canApplyDictionarySupplement,
  SKIP_REASON,
  SKIP_CATEGORY,
  ERROR_CATEGORY,
  EMPTY_DICT,
} from '../src/Translate/utils/engineBridge.js'

function hang() {
  return new Promise(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const CONFIGURED = {
  deeplApiKey: 'k',
  deeplxServerUrl: 'http://localhost:1188',
  thirdpartyAiGroups: [{
    id: 'g_a',
    name: '自定义 AI 1',
    url: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'm',
  }],
}

const PRELOAD_SERVICES = {
  googleTranslate: async () => 'ok',
  deeplTranslate: async () => 'ok',
  deeplxTranslate: async () => 'ok',
  requestThirdpartyAI: async () => ({ choices: [{ message: { content: 'ok' } }] }),
  lookupWord: async () => ({ phonetic: 'x', definitions: ['d'], examples: ['e'] }),
}

describe('inspectEngine', () => {
  it('window.services 整体缺失时 preload 引擎按环境跳过，不视为可调用', () => {
    const env = { services: undefined, utools: { ai: async () => ({}) } }
    for (const engine of ['google', 'deepl', 'deeplx', 'thirdparty-ai']) {
      const r = inspectEngine(engine, {
        deeplApiKey: 'k',
        deeplxServerUrl: 'http://localhost:1188',
        thirdpartyAiGroups: [{ id: 'g_a', name: 'A', url: 'https://api.example.com/v1', apiKey: 'sk', model: 'm' }],
      }, env)
      assert.equal(r.status, 'skipped')
      assert.equal(r.skipReason, SKIP_REASON.BRIDGE_MISSING)
      assert.equal(r.skipCategory, SKIP_CATEGORY.ENV)
    }
  })

  it('缺单个方法时只跳过对应引擎', () => {
    const env = {
      services: { ...PRELOAD_SERVICES, requestThirdpartyAI: undefined },
      utools: { ai: async () => ({}) },
    }
    const missing = inspectEngine('thirdparty-ai', {
      thirdpartyAiGroups: [{ id: 'g_a', name: 'A', url: 'https://api.example.com/v1', apiKey: 'sk', model: 'm' }],
    }, env)
    const google = inspectEngine('google', {}, env)
    assert.equal(missing.status, 'skipped')
    assert.equal(missing.skipReason, SKIP_REASON.METHOD_MISSING)
    assert.equal(google.status, 'ready')
  })

  it('未配置凭据时跳过且不把已有方法当成可调用', () => {
    const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }
    const deepl = inspectEngine('deepl', { deeplApiKey: '' }, env)
    const deeplx = inspectEngine('deeplx', { deeplxServerUrl: '  ' }, env)
    const ai3 = inspectEngine('thirdparty-ai', { thirdpartyAiGroups: [{ id: 'g_a', name: 'A', url: 'https://x', apiKey: 'sk', model: '' }] }, env)
    assert.equal(deepl.skipReason, SKIP_REASON.NOT_CONFIGURED)
    assert.equal(deeplx.skipReason, SKIP_REASON.NOT_CONFIGURED)
    assert.equal(ai3.skipReason, SKIP_REASON.NOT_CONFIGURED)
    assert.equal(deepl.skipCategory, SKIP_CATEGORY.CONFIG)
  })

  it('uTools AI 方法存在且 preload 完整时标记 ready', () => {
    const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }
    assert.equal(inspectEngine('ai', {}, env).status, 'ready')
    assert.equal(inspectEngine('google', {}, env).status, 'ready')
  })
})

describe('classifyError', () => {
  it('识别 524 且不把原始正文带进安全消息', () => {
    const r = classifyError(new Error('524 status code (no body)'))
    assert.equal(r.category, ERROR_CATEGORY.STATUS_524)
    assert.equal(r.statusCode, 524)
    assert.equal(r.safeMessage.includes('524'), true)
    assert.equal(r.safeMessage.includes('no body'), false)
  })

  it('识别 HTTP 状态码，丢弃响应正文', () => {
    const r = classifyError(new Error('HTTP 403: {"error":"secret-token"}'))
    assert.equal(r.category, ERROR_CATEGORY.HTTP_ERROR)
    assert.equal(r.statusCode, 403)
    assert.equal(r.safeMessage, '引擎返回 HTTP 403')
    assert.equal(r.safeMessage.includes('secret-token'), false)
  })

  it('识别超时且安全消息不含 URL/正文', () => {
    const r = classifyError(new Error('引擎请求超时 https://api.example.com/v1/chat?token=abc'))
    assert.equal(r.category, ERROR_CATEGORY.TIMEOUT)
    assert.equal(r.safeMessage, '引擎请求超时')
    assert.equal(r.safeMessage.includes('https://'), false)
    assert.equal(r.safeMessage.includes('token'), false)
  })

  it('识别代理连接失败并保留来源级安全诊断', () => {
    const err = new Error('代理连接失败')
    err.category = 'proxy_connect'
    err.googleAttempts = [
      { source: 'library', route: 'proxy', category: 'timeout', durationMs: 100 },
      { source: 'gtx', route: 'proxy', category: 'proxy_connect', durationMs: 80 },
      { source: 'gtx', route: 'direct', category: 'timeout', durationMs: 120, url: 'https://translate.googleapis.com/?q=机密' },
    ]
    const r = classifyError(err)
    assert.equal(r.category, ERROR_CATEGORY.PROXY_CONNECT)
    assert.equal(r.safeMessage.includes('代理'), true)
    assert.equal(r.safeMessage.includes('自填代理'), true)
    assert.equal(r.source, 'gtx')
    assert.equal(r.route, 'direct')
    assert.equal(r.googleAttempts.length, 3)
    const blob = JSON.stringify(r)
    assert.equal(blob.includes('googleapis'), false)
    assert.equal(blob.includes('机密'), false)
  })
})

describe('runEngineFailover', () => {
  it('services 缺失时 preload 引擎跳过，uTools AI 仍可成功', async () => {
    const calls = []
    const skipped = []
    const env = { services: undefined, utools: { ai: async () => ({ content: '{}' }) } }
    const out = await runEngineFailover({
      order: ['google', 'deepl', 'deeplx', 'thirdparty-ai', 'ai'],
      settings: {},
      env,
      translateWith: async (engine) => {
        calls.push(engine)
        return { translation: 'hello' }
      },
      isCurrent: () => true,
      onSkip: (engine, inspection) => skipped.push({ engine, ...inspection }),
    })
    assert.equal(out.success, true)
    assert.equal(out.engine, 'ai')
    assert.equal(out.fallback, true)
    assert.deepEqual(calls, ['ai'])
    assert.equal(skipped.length, 4)
    assert.ok(skipped.every(s => s.skipReason === SKIP_REASON.BRIDGE_MISSING))
  })

  it('524 只调用当前引擎一次并立即尝试下一已配置引擎', async () => {
    const calls = []
    const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }
    const out = await runEngineFailover({
      order: ['ai', 'google'],
      settings: {},
      env,
      translateWith: async (engine) => {
        calls.push(engine)
        if (engine === 'ai') {
          const err = new Error('524 status code (no body)')
          err.statusCode = 524
          throw err
        }
        return { translation: 'ok' }
      },
      isCurrent: () => true,
    })
    assert.deepEqual(calls, ['ai', 'google'])
    assert.equal(out.success, true)
    assert.equal(out.engine, 'google')
    assert.equal(out.outcomes[0].category, ERROR_CATEGORY.STATUS_524)
  })

  it('未配置项不发真实请求', async () => {
    const calls = []
    const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }
    await runEngineFailover({
      order: ['deepl', 'google'],
      settings: { deeplApiKey: '' },
      env,
      translateWith: async (engine) => {
        calls.push(engine)
        return { translation: 'ok' }
      },
      isCurrent: () => true,
    })
    assert.deepEqual(calls, ['google'])
  })

  it('过期请求不继续回填成功或失败回调', async () => {
    let current = true
    let successCount = 0
    let failCount = 0
    const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }
    const pending = runEngineFailover({
      order: ['google'],
      settings: {},
      env,
      translateWith: () => new Promise((resolve) => {
        current = false
        setTimeout(() => resolve({ translation: 'late' }), 10)
      }),
      isCurrent: () => current,
      onSuccess: () => { successCount += 1 },
      onFailure: () => { failCount += 1 },
    })
    const out = await pending
    assert.equal(out.stale, true)
    assert.equal(successCount, 0)
    assert.equal(failCount, 0)
  })

  it('全失败时给出可操作归因而不是原始 TypeError', async () => {
    const env = { services: undefined, utools: { ai: async () => ({}) } }
    const out = await runEngineFailover({
      order: ['ai', 'google', 'deepl'],
      settings: {},
      env,
      translateWith: async (engine) => {
        if (engine === 'ai') throw new Error('524 status code (no body)')
        throw new Error("Cannot read properties of undefined (reading 'requestThirdpartyAI')")
      },
      isCurrent: () => true,
    })
    assert.equal(out.success, false)
    assert.equal(out.message.includes('TypeError'), false)
    assert.equal(out.message.includes('requestThirdpartyAI'), false)
    assert.equal(out.message.includes('翻译服务未加载'), true)
    assert.equal(out.message.includes('524'), true)
  })
})

describe('buildAllFailedMessage / skipUserMessage', () => {
  it('共同阻断优先说明桥接未加载', () => {
    const msg = buildAllFailedMessage([
      { engine: 'google', status: 'skipped', skipReason: SKIP_REASON.BRIDGE_MISSING, skipCategory: SKIP_CATEGORY.ENV },
      { engine: 'deepl', status: 'skipped', skipReason: SKIP_REASON.BRIDGE_MISSING, skipCategory: SKIP_CATEGORY.ENV },
    ])
    assert.equal(msg.includes('重载'), true)
    assert.equal(skipUserMessage({ skipReason: SKIP_REASON.BRIDGE_MISSING }).includes('重载'), true)
  })

  it('均未配置时提示去设置页填写', () => {
    const msg = buildAllFailedMessage([
      { engine: 'deepl', status: 'skipped', skipReason: SKIP_REASON.NOT_CONFIGURED, skipCategory: SKIP_CATEGORY.CONFIG },
      { engine: 'deeplx', status: 'skipped', skipReason: SKIP_REASON.NOT_CONFIGURED, skipCategory: SKIP_CATEGORY.CONFIG },
    ])
    assert.equal(msg.includes('未配置') || msg.includes('设置'), true)
  })
})

describe('safeLookupWord', () => {
  it('lookupWord 缺失时返回空词典且不抛错', async () => {
    const r = await safeLookupWord('hello', { services: { googleTranslate: () => {} } })
    assert.deepEqual(r, EMPTY_DICT)
  })

  it('lookupWord 抛错时不破坏调用方', async () => {
    const r = await safeLookupWord('hello', {
      services: { lookupWord: async () => { throw new Error('boom') } },
    })
    assert.deepEqual(r, EMPTY_DICT)
  })
})

describe('runEngineFailover 引擎级超时', () => {
  const env = { services: PRELOAD_SERVICES, utools: { ai: async () => ({}) } }

  it('永不返回的主引擎在时限内超时并立即尝试下一引擎', async () => {
    const calls = []
    const failures = []
    const t0 = Date.now()
    const out = await runEngineFailover({
      order: ['ai', 'google'],
      settings: {},
      env,
      timeoutMs: 60,
      translateWith: async (engine) => {
        calls.push({ engine, at: Date.now() })
        if (engine === 'ai') return hang()
        return { translation: 'ok' }
      },
      isCurrent: () => true,
      onFailure: (engine, classified) => failures.push({ engine, ...classified }),
    })
    const elapsed = Date.now() - t0
    assert.deepEqual(calls.map(c => c.engine), ['ai', 'google'])
    assert.ok(calls[1].at - calls[0].at >= 40)
    assert.ok(elapsed < 400, `应立即回退，实际 ${elapsed}ms`)
    assert.equal(out.success, true)
    assert.equal(out.engine, 'google')
    assert.equal(out.fallback, true)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].engine, 'ai')
    assert.equal(failures[0].category, ERROR_CATEGORY.TIMEOUT)
  })

  it('五种 ready 引擎永久挂起时各自超时且每个只计一次失败', async () => {
    const engines = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx']
    const calls = []
    const failures = []
    const t0 = Date.now()
    const out = await runEngineFailover({
      order: engines,
      settings: CONFIGURED,
      env,
      timeoutMs: 40,
      translateWith: async (engine) => {
        calls.push(engine)
        if (engine === 'thirdparty-ai') {
          await delay(40)
          throw new Error('引擎请求超时')
        }
        return hang()
      },
      isCurrent: () => true,
      onFailure: (engine, classified) => failures.push({ engine, category: classified.category }),
      onSkip: () => { throw new Error('ready 引擎不应跳过') },
    })
    const elapsed = Date.now() - t0
    assert.deepEqual(calls, engines)
    assert.equal(out.success, false)
    assert.equal(failures.length, 5)
    assert.ok(failures.every(f => f.category === ERROR_CATEGORY.TIMEOUT))
    assert.ok(elapsed < 500, `五引擎串行超时过长: ${elapsed}ms`)
    assert.ok(elapsed >= 150, `应消耗每引擎独立预算，实际 ${elapsed}ms`)
    assert.equal(out.message.includes('TypeError'), false)
    assert.equal(out.message.includes('https://'), false)
  })

  it('未配置/缺桥接仍跳过且不计失败，超时只发生在真实调用', async () => {
    const calls = []
    const skipped = []
    const failures = []
    const out = await runEngineFailover({
      order: ['deepl', 'google'],
      settings: { deeplApiKey: '' },
      env,
      timeoutMs: 40,
      translateWith: async (engine) => {
        calls.push(engine)
        if (engine === 'google') return hang()
        return { translation: 'should-not' }
      },
      isCurrent: () => true,
      onSkip: (engine, inspection) => skipped.push({ engine, ...inspection }),
      onFailure: (engine, classified) => failures.push({ engine, category: classified.category }),
    })
    assert.deepEqual(calls, ['google'])
    assert.equal(skipped.length, 1)
    assert.equal(skipped[0].skipReason, SKIP_REASON.NOT_CONFIGURED)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].engine, 'google')
    assert.equal(failures[0].category, ERROR_CATEGORY.TIMEOUT)
    assert.equal(out.success, false)
  })

  it('第一个超时后第二个获得独立完整预算', async () => {
    const started = {}
    const failedAt = {}
    await runEngineFailover({
      order: ['ai', 'google'],
      settings: {},
      env,
      timeoutMs: 70,
      translateWith: async (engine) => {
        started[engine] = Date.now()
        return hang()
      },
      isCurrent: () => true,
      onFailure: (engine) => { failedAt[engine] = Date.now() },
    })
    const firstBudget = failedAt.ai - started.ai
    const secondBudget = failedAt.google - started.google
    assert.ok(firstBudget >= 50 && firstBudget < 250, `第一引擎预算 ${firstBudget}`)
    assert.ok(secondBudget >= 50 && secondBudget < 250, `第二引擎预算 ${secondBudget}`)
    assert.ok(started.google - started.ai >= 50)
  })

  it('使用传入 timeoutMs 快照，不读取 settings 中途改值', async () => {
    const settings = { engineResponseTimeoutSeconds: 60 }
    const t0 = Date.now()
    const pending = runEngineFailover({
      order: ['ai'],
      settings,
      env,
      timeoutMs: 50,
      translateWith: async () => {
        settings.engineResponseTimeoutSeconds = 60
        return hang()
      },
      isCurrent: () => true,
    })
    const out = await pending
    const elapsed = Date.now() - t0
    assert.equal(out.success, false)
    assert.equal(out.outcomes[0].category, ERROR_CATEGORY.TIMEOUT)
    assert.ok(elapsed < 300, `应使用 50ms 快照而非 60s，实际 ${elapsed}ms`)
  })

  it('524 不等待配置时限就回退', async () => {
    const t0 = Date.now()
    const out = await runEngineFailover({
      order: ['ai', 'google'],
      settings: {},
      env,
      timeoutMs: 2000,
      translateWith: async (engine) => {
        if (engine === 'ai') {
          const err = new Error('524 status code (no body)')
          err.statusCode = 524
          throw err
        }
        return { translation: 'ok' }
      },
      isCurrent: () => true,
    })
    const elapsed = Date.now() - t0
    assert.equal(out.success, true)
    assert.equal(out.engine, 'google')
    assert.equal(out.outcomes[0].category, ERROR_CATEGORY.STATUS_524)
    assert.ok(elapsed < 300, `524 应立即回退，实际 ${elapsed}ms`)
  })

  it('超时后迟到 resolve 不回填成功、不重复统计', async () => {
    let resolveLate
    const late = new Promise((resolve) => { resolveLate = resolve })
    let successCount = 0
    let failCount = 0
    const out = await runEngineFailover({
      order: ['google', 'ai'],
      settings: {},
      env,
      timeoutMs: 40,
      translateWith: async (engine) => {
        if (engine === 'google') return late
        return { translation: 'backup' }
      },
      isCurrent: () => true,
      onSuccess: () => { successCount += 1 },
      onFailure: () => { failCount += 1 },
    })
    resolveLate({ translation: 'late-primary' })
    await delay(20)
    assert.equal(out.success, true)
    assert.equal(out.engine, 'ai')
    assert.equal(successCount, 1)
    assert.equal(failCount, 1)
  })

  it('超时后迟到 reject 不重复失败且无未处理拒绝', async () => {
    let rejectLate
    const late = new Promise((_, reject) => { rejectLate = reject })
    const unhandled = []
    const onUnhandled = (err) => { unhandled.push(err) }
    process.on('unhandledRejection', onUnhandled)
    try {
      let failCount = 0
      const out = await runEngineFailover({
        order: ['google', 'ai'],
        settings: {},
        env,
        timeoutMs: 40,
        translateWith: async (engine) => {
          if (engine === 'google') return late
          return { translation: 'backup' }
        },
        isCurrent: () => true,
        onFailure: () => { failCount += 1 },
      })
      rejectLate(new Error('late boom https://secret.example/token=abc'))
      await delay(20)
      assert.equal(out.success, true)
      assert.equal(failCount, 1)
      assert.equal(unhandled.length, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('主译文与词典解耦', () => {
  it('runMainTextTranslation 不等待词典即可返回主译文', async () => {
    const result = await runMainTextTranslation(
      async () => 'hello',
      'hi',
      'en',
      'zh-CN',
    )
    assert.equal(result.translation, 'hello')
    assert.equal(result.phonetic, undefined)
  })

  it('空译文视为失败而不是成功', async () => {
    await assert.rejects(
      () => runMainTextTranslation(async () => '  ', 'hi', 'en', 'zh-CN'),
      /空/
    )
  })

  it('英译中查原文、中译英查译文、句子不查词典', () => {
    assert.equal(wordLookupTarget({ type: 'word', lang: 'en', sourceText: 'hello', translation: '你好' }), 'hello')
    assert.equal(wordLookupTarget({ type: 'word', lang: 'zh', sourceText: '你好', translation: 'hello' }), 'hello')
    assert.equal(wordLookupTarget({ type: 'sentence', lang: 'en', sourceText: 'hello world', translation: '你好世界' }), null)
  })

  it('词典晚到：请求过期、引擎已变或译文已变则不合并', () => {
    const base = {
      engine: 'google',
      usedEngine: 'google',
      translation: '你好',
      currentTranslation: '你好',
      isCurrent: () => true,
    }
    assert.equal(canApplyDictionarySupplement(base), true)
    assert.equal(canApplyDictionarySupplement({ ...base, isCurrent: () => false }), false)
    assert.equal(canApplyDictionarySupplement({ ...base, usedEngine: 'deepl' }), false)
    assert.equal(canApplyDictionarySupplement({ ...base, currentTranslation: '新译文' }), false)
  })
})
