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
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  KNOWN_ENGINES,
} = await import('../src/Translate/utils/storage.js')

const STORAGE_KEY = 'dev-translation-settings'
const ALL_OFF = Object.fromEntries(KNOWN_ENGINES.map(e => [e, false]))

describe('engineEnabled 持久化', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('新安装默认八项全部开启', () => {
    const s = loadSettings()
    assert.equal(KNOWN_ENGINES.length, 8)
    for (const engine of KNOWN_ENGINES) assert.equal(s.engineEnabled[engine], true)
  })

  it('旧配置缺少启停字段时默认全部开启，且保留顺序/Key/组/提示词/时限', () => {
    store[STORAGE_KEY] = JSON.stringify({
      failoverOrder: ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'],
      deeplApiKey: 'keep-key',
      thirdpartyAiSystemPrompt: 'keep prompt',
      engineResponseTimeoutSeconds: 12,
    })
    const s = loadSettings()
    for (const engine of KNOWN_ENGINES) assert.equal(s.engineEnabled[engine], true)
    assert.equal(s.deeplApiKey, 'keep-key')
    assert.equal(s.thirdpartyAiSystemPrompt, 'keep prompt')
    assert.equal(s.engineResponseTimeoutSeconds, 12)
    assert.deepEqual(s.failoverOrder, ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun'])
  })

  it('显式 false 与全 false 均原样保留，不因缺失恢复默认', () => {
    store[STORAGE_KEY] = JSON.stringify({ engineEnabled: { ai: false, google: false } })
    const partial = loadSettings()
    assert.equal(partial.engineEnabled.ai, false)
    assert.equal(partial.engineEnabled.google, false)
    assert.equal(partial.engineEnabled.deepl, true)

    store[STORAGE_KEY] = JSON.stringify({ engineEnabled: ALL_OFF })
    const allOff = loadSettings()
    for (const engine of KNOWN_ENGINES) assert.equal(allOff.engineEnabled[engine], false)
  })

  it('缺键/非法值默认 true，未知键不透传', () => {
    store[STORAGE_KEY] = JSON.stringify({ engineEnabled: { ai: true, google: 'off', baidu: 0, unknown: false } })
    const s = loadSettings()
    assert.equal(s.engineEnabled.ai, true)
    assert.equal(s.engineEnabled.google, true)
    assert.equal(s.engineEnabled.baidu, true)
    assert.equal('unknown' in s.engineEnabled, false)
  })

  it('保存后重新加载保持开关，且不写入未知键', () => {
    const current = loadSettings()
    current.engineEnabled = { ...current.engineEnabled, deepl: false, unknown: false }
    assert.equal(saveSettings(current), true)
    const loaded = loadSettings()
    assert.equal(loaded.engineEnabled.deepl, false)
    assert.equal('unknown' in loaded.engineEnabled, false)
    const raw = JSON.parse(store[STORAGE_KEY])
    assert.equal(raw.engineEnabled.deepl, false)
    assert.equal('unknown' in raw.engineEnabled, false)
    // 保存开关不得改变持久化顺序
    assert.deepEqual(raw.failoverOrder, current.failoverOrder)
  })

  it('独立切换开关不修改顺序、配置与自定义 AI 组', () => {
    store[STORAGE_KEY] = JSON.stringify({
      failoverOrder: ['baidu', 'ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'aliyun', 'caiyun'],
      deeplApiKey: 'k',
      thirdpartyAiGroups: [{ id: 'g_x', name: 'X', url: 'https://x.example/v1', apiKey: 'sk', model: 'm' }],
      output: true,
    })
    const before = loadSettings()
    const after = loadSettings()
    after.engineEnabled = { ...after.engineEnabled, baidu: false }
    assert.equal(saveSettings(after), true)
    const reloaded = loadSettings()
    assert.deepEqual(reloaded.failoverOrder, before.failoverOrder)
    assert.equal(reloaded.deeplApiKey, 'k')
    assert.equal(reloaded.thirdpartyAiGroups.length, 1)
    assert.equal(reloaded.engineEnabled.baidu, false)
    assert.equal(reloaded.engineEnabled.ai, true)
  })

  it('默认设置对象不共享同一可变映射', () => {
    const a = loadSettings()
    a.engineEnabled.ai = false
    const b = loadSettings()
    assert.equal(b.engineEnabled.ai, true)
    assert.equal(DEFAULT_SETTINGS.engineEnabled.ai, true)
  })
})
