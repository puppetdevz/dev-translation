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
  parseGoogleProxyUrl,
  normalizeGoogleProxySettings,
  snapshotGoogleProxy,
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

  it('写入层明确返回 false 时不得报告保存成功', () => {
    const original = window.utools.dbStorage.setItem
    window.utools.dbStorage.setItem = () => false
    try {
      assert.equal(saveSettings({ ...DEFAULT_SETTINGS }), false)
    } finally {
      window.utools.dbStorage.setItem = original
    }
  })

  it('写入抛错时不把敏感异常正文写进控制台', () => {
    const originalSet = window.utools.dbStorage.setItem
    const originalError = console.error
    const logs = []
    window.utools.dbStorage.setItem = () => { throw new Error('https://secret.example.com sk-token') }
    console.error = (...args) => logs.push(args.join(' '))
    try {
      assert.equal(saveSettings({ ...DEFAULT_SETTINGS }), false)
      assert.equal(logs.length, 1)
      assert.equal(logs[0].includes('secret'), false)
      assert.equal(logs[0].includes('sk-token'), false)
    } finally {
      window.utools.dbStorage.setItem = originalSet
      console.error = originalError
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

describe('Google 代理设置', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('新安装默认关闭且地址为空', () => {
    const s = loadSettings()
    assert.equal(s.googleProxyEnabled, false)
    assert.equal(s.googleProxyUrl, '')
    assert.equal(DEFAULT_SETTINGS.googleProxyEnabled, false)
  })

  it('拒绝 SOCKS5、凭据、空地址启用和畸形 URL', () => {
    assert.equal(parseGoogleProxyUrl('').reason, 'empty')
    assert.equal(parseGoogleProxyUrl('socks5://127.0.0.1:1080').reason, 'protocol')
    assert.equal(parseGoogleProxyUrl('http://user:pass@127.0.0.1:8080').reason, 'credentials')
    assert.equal(parseGoogleProxyUrl('not a url').reason, 'malformed')
    assert.equal(parseGoogleProxyUrl('http://127.0.0.1:7890').ok, true)
    assert.equal(parseGoogleProxyUrl('https://proxy.example:8443').url, 'https://proxy.example:8443')
    const invalidEnabled = normalizeGoogleProxySettings({
      googleProxyEnabled: true,
      googleProxyUrl: 'socks5://127.0.0.1:1080',
    })
    assert.equal(invalidEnabled.googleProxyEnabled, false)
    assert.equal(snapshotGoogleProxy({
      googleProxyEnabled: true,
      googleProxyUrl: 'http://user:x@127.0.0.1:9',
    }).proxyEnabled, false)
  })

  it('合法代理可保存并在重新加载后保持；非法启用不会落成有效开启', () => {
    const current = loadSettings()
    current.googleProxyEnabled = true
    current.googleProxyUrl = 'http://127.0.0.1:7890'
    assert.equal(saveSettings(current), true)
    const loaded = loadSettings()
    assert.equal(loaded.googleProxyEnabled, true)
    assert.equal(loaded.googleProxyUrl, 'http://127.0.0.1:7890')

    loaded.googleProxyEnabled = true
    loaded.googleProxyUrl = 'socks5://127.0.0.1:1080'
    assert.equal(saveSettings(loaded), true)
    const again = loadSettings()
    assert.equal(again.googleProxyEnabled, false)
  })

  it('旧配置缺字段时补默认关闭，不丢其它设置', () => {
    store[STORAGE_KEY] = JSON.stringify({
      deeplApiKey: 'keep-key',
      failoverOrder: ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'],
    })
    const s = loadSettings()
    assert.equal(s.googleProxyEnabled, false)
    assert.equal(s.googleProxyUrl, '')
    assert.equal(s.deeplApiKey, 'keep-key')
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
