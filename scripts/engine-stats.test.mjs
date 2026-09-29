import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

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
  recordEngineResult,
  recordEngineSkip,
  computeStability,
  getEngineStat,
  clearEngineStats,
  normalizeEngineStat,
} = await import('../src/Translate/utils/engineStats.js')

describe('engineStats skip vs call', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('跳过不计入 total / recent / 成功率，失败才计入', () => {
    recordEngineSkip('google', 'env')
    recordEngineSkip('google', 'config')
    recordEngineResult('google', false)
    recordEngineResult('google', true)
    const s = getEngineStat('google')
    assert.equal(s.skipped, 2)
    assert.equal(s.skipEnv, 1)
    assert.equal(s.skipConfig, 1)
    assert.equal(s.total, 2)
    assert.equal(s.success, 1)
    assert.equal(s.failure, 1)
    assert.deepEqual(s.recent, [0, 1])
    const m = computeStability(s)
    assert.equal(m.rate, 0.5)
    assert.equal(m.skipped, 2)
  })

  it('读取旧统计时跳过数缺省为 0 且保留原成功/失败', () => {
    store['dev-translation-engine-stats'] = {
      ai: { total: 10, success: 8, failure: 2, recent: [1, 0, 1], lastTime: 1, lastSuccess: 2, lastFailure: 3 },
    }
    const s = getEngineStat('ai')
    assert.equal(s.skipped, 0)
    assert.equal(s.skipEnv, 0)
    assert.equal(s.skipConfig, 0)
    assert.equal(s.success, 8)
    assert.equal(s.failure, 2)
    assert.equal(s.total, 10)
  })

  it('清空统计时一并清空跳过数', () => {
    recordEngineSkip('deepl', 'config')
    recordEngineResult('deepl', false)
    clearEngineStats()
    const s = getEngineStat('deepl')
    assert.equal(s.skipped, 0)
    assert.equal(s.total, 0)
    assert.equal(s.failure, 0)
  })

  it('normalizeEngineStat 兼容残缺对象', () => {
    const s = normalizeEngineStat({ success: 3 })
    assert.equal(s.success, 3)
    assert.equal(s.skipped, 0)
    assert.deepEqual(s.recent, [])
  })
})
