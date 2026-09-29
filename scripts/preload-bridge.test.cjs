'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const path = require('node:path')
const http = require('node:http')

const SERVICES = path.resolve(__dirname, '../public/preload/services.js')

function loadServicesWithGoogleRequire(shouldFail) {
  delete require.cache[SERVICES]
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'google-translate-api-x') {
      if (shouldFail) throw new Error('simulated missing google-translate-api-x')
      return origLoad.apply(this, arguments)
    }
    return origLoad.apply(this, arguments)
  }
  global.window = {}
  try {
    const mod = require(SERVICES)
    return {
      services: global.window.services,
      testApi: mod && mod.__test__,
    }
  } finally {
    Module._load = origLoad
    delete require.cache[SERVICES]
  }
}

function hang() {
  return new Promise(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const METHODS = [
  'googleTranslate',
  'deeplTranslate',
  'deeplxTranslate',
  'requestThirdpartyAI',
  'fetchThirdpartyModels',
  'lookupWord',
]

describe('preload window.services 初始化', () => {
  it('google-translate-api-x 缺失时仍完整挂上桥接方法', () => {
    const { services } = loadServicesWithGoogleRequire(true)
    assert.ok(services, 'window.services 应存在')
    for (const name of METHODS) {
      assert.equal(typeof services[name], 'function', name + ' 应为函数')
    }
  })

  it('依赖可用时同样挂上全部方法', () => {
    const { services } = loadServicesWithGoogleRequire(false)
    assert.ok(services, 'window.services 应存在')
    for (const name of METHODS) {
      assert.equal(typeof services[name], 'function', name + ' 应为函数')
    }
  })
})

describe('Google 三源预算与 inflight', () => {
  let services
  let testApi

  beforeEach(() => {
    const loaded = loadServicesWithGoogleRequire(true)
    services = loaded.services
    testApi = loaded.testApi
    assert.ok(testApi, '应导出 __test__ 供隔离测试')
    testApi.clearTranslateCache()
  })

  afterEach(() => {
    if (testApi) {
      testApi.restoreTranslateSources()
      testApi.clearTranslateCache()
    }
  })

  it('第一源挂起时总等待不超过自身预算，不启动后续源', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: async () => { started.push('a'); return hang() } },
      { name: 'b', fn: async () => { started.push('b'); return 'b' } },
      { name: 'c', fn: async () => { started.push('c'); return 'c' } },
    ])
    const t0 = Date.now()
    await assert.rejects(
      () => services.googleTranslate('hello', 'en', 'zh-CN', 70),
      /超时/
    )
    const elapsed = Date.now() - t0
    assert.deepEqual(started, ['a'])
    assert.ok(elapsed < 280, `不得把三源叠加到 3 倍，实际 ${elapsed}ms`)
    assert.ok(elapsed >= 50)
  })

  it('第一源提前失败且时间有余则尝试第二源', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: async () => { started.push('a'); throw new Error('fail-a') } },
      { name: 'b', fn: async () => { started.push('b'); return 'ok-b' } },
      { name: 'c', fn: async () => { started.push('c'); return 'ok-c' } },
    ])
    const result = await services.googleTranslate('hello', 'en', 'zh-CN', 200)
    assert.equal(result, 'ok-b')
    assert.deepEqual(started, ['a', 'b'])
  })

  it('无剩余时间不再启动新源', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: async (_t, _f, _to, timeoutMs) => {
        started.push('a')
        await delay(Math.max(1, timeoutMs + 20))
        throw new Error('slow-a')
      } },
      { name: 'b', fn: async () => { started.push('b'); return 'b' } },
    ])
    await assert.rejects(
      () => services.googleTranslate('hello', 'en', 'zh-CN', 40),
      /超时/
    )
    assert.equal(started.includes('a'), true)
    assert.equal(started.includes('b'), false)
  })

  it('相同文本并发等待时，一个超时不破坏另一有效等待者及缓存', async () => {
    let resolveSource
    let sourceCalls = 0
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: () => {
        sourceCalls += 1
        return new Promise((resolve) => { resolveSource = resolve })
      } },
    ])
    const p1 = services.googleTranslate('same-text', 'en', 'zh-CN', 40)
    const p2 = services.googleTranslate('same-text', 'en', 'zh-CN', 300)
    await assert.rejects(p1, /超时/)
    resolveSource('shared-ok')
    assert.equal(await p2, 'shared-ok')
    assert.equal(sourceCalls, 1)
    assert.equal(await services.googleTranslate('same-text', 'en', 'zh-CN', 40), 'shared-ok')
    assert.equal(sourceCalls, 1)
  })

  it('全部等待者超时后迟到结果不写入缓存', async () => {
    let resolveSource
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: () => new Promise((resolve) => { resolveSource = resolve }) },
    ])
    await assert.rejects(
      () => services.googleTranslate('late-cache', 'en', 'zh-CN', 40),
      /超时/
    )
    resolveSource('late-ok')
    await delay(20)
    let started = 0
    testApi.setTranslateSourcesForTest([
      { name: 'b', fn: async () => { started += 1; return 'fresh' } },
    ])
    assert.equal(await services.googleTranslate('late-cache', 'en', 'zh-CN', 120), 'fresh')
    assert.equal(started, 1)
  })

  it('未传预算时仍可走完多源（设置页测试兼容）', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: async () => { started.push('a'); throw new Error('fail-a') } },
      { name: 'b', fn: async () => { started.push('b'); return 'legacy-b' } },
    ])
    assert.equal(await services.googleTranslate('hello', 'en', 'zh-CN'), 'legacy-b')
    assert.deepEqual(started, ['a', 'b'])
  })
})

describe('翻译 HTTP 超时取消与非翻译接口时限', () => {
  let services
  let testApi
  let server
  let connections

  beforeEach(async () => {
    const loaded = loadServicesWithGoogleRequire(true)
    services = loaded.services
    testApi = loaded.testApi
    connections = new Set()
    server = http.createServer((req, res) => {
      req.resume()
      // 故意不响应，模拟挂起
    })
    server.on('connection', (socket) => {
      connections.add(socket)
      socket.on('close', () => connections.delete(socket))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    if (testApi) {
      testApi.restoreTranslateSources()
      testApi.clearTranslateCache()
    }
    if (server) {
      for (const socket of connections) {
        try { socket.destroy() } catch (e) { /* ignore */ }
      }
      await new Promise((resolve) => server.close(() => resolve()))
    }
  })

  function origin() {
    return `http://127.0.0.1:${server.address().port}`
  }

  it('postJson 超时会 destroy 请求且无悬挂连接', async () => {
    const t0 = Date.now()
    await assert.rejects(
      () => testApi.postJson(origin() + '/t', { q: 1 }, {}, 60),
      /超时/
    )
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 300)
    await delay(40)
    assert.equal(connections.size, 0)
  })

  it('requestThirdpartyAI 传入预算覆盖默认 30000ms', async () => {
    const t0 = Date.now()
    await assert.rejects(
      () => services.requestThirdpartyAI(origin() + '/v1', 'k', { model: 'm', messages: [] }, 50),
      /超时/
    )
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 300, `翻译路径应使用传入预算，实际 ${elapsed}ms`)
  })

  it('deeplxTranslate 传入预算后超时', async () => {
    const t0 = Date.now()
    await assert.rejects(
      () => services.deeplxTranslate('hi', 'en', 'zh-CN', origin(), '', 50),
      /超时/
    )
    assert.ok(Date.now() - t0 < 300)
  })

  it('未传超时的 requestThirdpartyAI 仍使用 30000 默认（不在本用例等待）', () => {
    assert.equal(testApi.THIRDPARTY_AI_TIMEOUT_MS, 30000)
    assert.equal(testApi.TIMEOUT_MS, 5000)
    assert.equal(testApi.LOOKUP_TIMEOUT_MS, 5000)
    assert.equal(services.requestThirdpartyAI.length, 4)
    assert.equal(services.fetchThirdpartyModels.length, 2)
    assert.equal(services.lookupWord.length, 1)
  })
})
