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
  normalizeEngineResponseTimeoutSeconds,
  snapshotEngineTimeoutMs,
  ENGINE_RESPONSE_TIMEOUT_DEFAULT,
} = await import('../src/Translate/utils/storage.js')

const STORAGE_KEY = 'dev-translation-settings'

describe('normalizeEngineResponseTimeoutSeconds', () => {
  it('缺省、空值、非整数与越界均回退为 5', () => {
    const invalid = [undefined, null, '', '  ', '5.5', 5.5, 0, -1, 61, 99, NaN, Infinity, true, false, 'abc', '10s', {}, []]
    for (const value of invalid) {
      assert.equal(
        normalizeEngineResponseTimeoutSeconds(value),
        ENGINE_RESPONSE_TIMEOUT_DEFAULT,
        `应拒绝 ${String(value)}`
      )
    }
  })

  it('接受 1–60 的整数及整数字符串', () => {
    assert.equal(normalizeEngineResponseTimeoutSeconds(1), 1)
    assert.equal(normalizeEngineResponseTimeoutSeconds(60), 60)
    assert.equal(normalizeEngineResponseTimeoutSeconds(5), 5)
    assert.equal(normalizeEngineResponseTimeoutSeconds('12'), 12)
    assert.equal(normalizeEngineResponseTimeoutSeconds(' 8 '), 8)
  })
})

describe('loadSettings 超时字段', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('新安装无存储时使用默认 5 秒，且含超时字段', () => {
    const s = loadSettings()
    assert.equal(s.engineResponseTimeoutSeconds, 5)
    assert.equal(DEFAULT_SETTINGS.engineResponseTimeoutSeconds, 5)
  })

  it('旧存储缺字段时补 5 秒并保留其它设置与排序', () => {
    store[STORAGE_KEY] = JSON.stringify({
      deeplApiKey: 'keep-key',
      failoverOrder: ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'],
      logLevel: 'debug',
    })
    const s = loadSettings()
    assert.equal(s.engineResponseTimeoutSeconds, 5)
    assert.equal(s.deeplApiKey, 'keep-key')
    assert.equal(s.logLevel, 'debug')
    assert.deepEqual(s.failoverOrder, ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'])
  })

  it('存储为空值、小数、0、负数、61、非数字时回退 5 秒且不丢其它字段', () => {
    const samples = ['', '5.5', 0, -3, 61, 'nope', null]
    for (const raw of samples) {
      store[STORAGE_KEY] = JSON.stringify({
        engineResponseTimeoutSeconds: raw,
        deeplxServerUrl: 'http://localhost:1188',
        failoverOrder: ['deepl', 'google', 'ai', 'thirdparty-ai', 'deeplx'],
      })
      const s = loadSettings()
      assert.equal(s.engineResponseTimeoutSeconds, 5, `raw=${String(raw)}`)
      assert.equal(s.deeplxServerUrl, 'http://localhost:1188')
      assert.equal(s.failoverOrder[0], 'deepl')
    }
  })

  it('合法端点 1 与 60 可保存并在重新加载后保持', () => {
    for (const value of [1, 60]) {
      const current = loadSettings()
      current.engineResponseTimeoutSeconds = value
      current.deeplApiKey = 'persist-key'
      assert.equal(saveSettings(current), true)
      const loaded = loadSettings()
      assert.equal(loaded.engineResponseTimeoutSeconds, value)
      assert.equal(loaded.deeplApiKey, 'persist-key')
    }
  })

  it('整个存储 JSON 损坏时回退默认设置', () => {
    store[STORAGE_KEY] = '{not-json'
    const s = loadSettings()
    assert.equal(s.engineResponseTimeoutSeconds, 5)
    assert.deepEqual(s.failoverOrder, DEFAULT_SETTINGS.failoverOrder)
    assert.equal(s.deeplApiKey, '')
  })
})

describe('snapshotEngineTimeoutMs', () => {
  it('按规范化后的秒数转为毫秒，供一次翻译快照使用', () => {
    assert.equal(snapshotEngineTimeoutMs({ engineResponseTimeoutSeconds: 1 }), 1000)
    assert.equal(snapshotEngineTimeoutMs({ engineResponseTimeoutSeconds: 5 }), 5000)
    assert.equal(snapshotEngineTimeoutMs({ engineResponseTimeoutSeconds: 61 }), 5000)
    assert.equal(snapshotEngineTimeoutMs({}), 5000)
  })

  it('快照后修改 settings 不影响已取出的毫秒值', () => {
    const settings = { engineResponseTimeoutSeconds: 1 }
    const snap = snapshotEngineTimeoutMs(settings)
    settings.engineResponseTimeoutSeconds = 5
    assert.equal(snap, 1000)
    assert.equal(snapshotEngineTimeoutMs(settings), 5000)
  })
})
