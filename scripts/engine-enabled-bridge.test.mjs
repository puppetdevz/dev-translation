import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  runEngineFailover,
  inspectEngineForCall,
  inspectEngine,
  inspectEngineAdmission,
  SKIP_REASON,
  SKIP_CATEGORY,
  NO_ENABLED_ENGINE_MESSAGE,
} from '../src/Translate/utils/engineBridge.js'
import { KNOWN_ENGINES, defaultEngineEnabled } from '../src/Translate/utils/engineAvailability.js'

const ENV = {
  services: {
    googleTranslate: async () => 'ok',
    deeplTranslate: async () => 'ok',
    deeplxTranslate: async () => 'ok',
    baiduTranslate: async () => 'ok',
    aliyunTranslate: async () => 'ok',
    caiyunTranslate: async () => 'ok',
    requestThirdpartyAI: async () => ({ choices: [{ message: { content: 'ok' } }] }),
  },
  utools: { ai: async () => ({ content: 'ok' }) },
}

const ALL_OFF = Object.fromEntries(KNOWN_ENGINES.map(e => [e, false]))

describe('关闭项准入', () => {
  it('自动路径跳过关闭项，手动检查不看开关', () => {
    const settings = { engineEnabled: { ...defaultEngineEnabled(), google: false } }
    const auto = inspectEngineForCall('google', settings, ENV, 'hello')
    assert.equal(auto.status, 'skipped')
    assert.equal(auto.skipReason, SKIP_REASON.DISABLED)
    assert.equal(auto.skipCategory, SKIP_CATEGORY.DISABLED)
    // 手动维护（单引擎测试/模型拉取）仍可检查配置
    assert.equal(inspectEngine('google', settings, ENV).status, 'ready')
  })

  it('显式准入函数与 inspectEngineForCall 一致', () => {
    const settings = { engineEnabled: { ...defaultEngineEnabled(), ai: false } }
    assert.equal(inspectEngineAdmission('ai', settings).skipReason, SKIP_REASON.DISABLED)
    assert.equal(inspectEngineAdmission('google', settings).status, 'ready')
  })
})

describe('runEngineFailover 全关语义', () => {
  it('全部关闭时不发请求、不隐式恢复 uTools AI', async () => {
    const calls = []
    const out = await runEngineFailover({
      order: [...KNOWN_ENGINES],
      settings: { engineEnabled: ALL_OFF },
      env: ENV,
      translateWith: async (engine) => { calls.push(engine); return { translation: 'x' } },
      isCurrent: () => true,
    })
    assert.equal(out.success, false)
    assert.equal(out.noEngine, true)
    assert.equal(out.message, NO_ENABLED_ENGINE_MESSAGE)
    assert.deepEqual(calls, [])
    assert.deepEqual(out.outcomes, [])
  })

  it('显式空数组是合法全关，不得兜底成 ai', async () => {
    const calls = []
    const out = await runEngineFailover({
      order: [],
      settings: {},
      env: ENV,
      translateWith: async (engine) => { calls.push(engine); return { translation: 'x' } },
      isCurrent: () => true,
    })
    assert.equal(out.noEngine, true)
    assert.deepEqual(calls, [])
  })

  it('缺失 order 参数才按历史兼容走 ai', async () => {
    const calls = []
    const out = await runEngineFailover({
      settings: {},
      env: ENV,
      translateWith: async (engine) => { calls.push(engine); return { translation: 'x' } },
      isCurrent: () => true,
    })
    assert.equal(out.success, true)
    assert.deepEqual(calls, ['ai'])
  })

  it('部分关闭时只调用开启项，关闭项不进 outcomes 也不计跳过', async () => {
    const calls = []
    const skipped = []
    const engineEnabled = Object.fromEntries(KNOWN_ENGINES.map(e => [e, e === 'google']))
    const out = await runEngineFailover({
      order: [...KNOWN_ENGINES],
      settings: { engineEnabled },
      env: ENV,
      translateWith: async (engine) => { calls.push(engine); return { translation: 'x' } },
      isCurrent: () => true,
      onSkip: (engine, inspection) => skipped.push({ engine, reason: inspection.skipReason }),
    })
    assert.equal(out.success, true)
    assert.deepEqual(calls, ['google'])
    assert.equal(skipped.some(s => s.engine === 'ai'), false)
    assert.equal(skipped.some(s => s.engine === 'deepl'), false)
  })
})
