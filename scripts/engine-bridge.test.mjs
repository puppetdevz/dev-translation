import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  inspectEngine,
  classifyError,
  runEngineFailover,
  buildAllFailedMessage,
  skipUserMessage,
  safeLookupWord,
  SKIP_REASON,
  SKIP_CATEGORY,
  ERROR_CATEGORY,
  EMPTY_DICT,
} from '../src/Translate/utils/engineBridge.js'

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
        thirdpartyAiUrl: 'https://api.example.com/v1',
        thirdpartyAiModel: 'm',
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
      thirdpartyAiUrl: 'https://api.example.com/v1',
      thirdpartyAiModel: 'm',
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
    const ai3 = inspectEngine('thirdparty-ai', { thirdpartyAiUrl: 'https://x', thirdpartyAiModel: '' }, env)
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
