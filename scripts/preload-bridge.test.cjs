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

  it('第一源挂起时仍尝试后续源，总等待不超过自身预算', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      { name: 'a', fn: async () => { started.push('a'); return hang() } },
      { name: 'b', fn: async () => { started.push('b'); return 'ok-b' } },
      { name: 'c', fn: async () => { started.push('c'); return 'ok-c' } },
    ])
    const t0 = Date.now()
    const result = await services.googleTranslate('hello', 'en', 'zh-CN', 120)
    const elapsed = Date.now() - t0
    assert.equal(result, 'ok-b')
    assert.deepEqual(started, ['a', 'b'])
    assert.ok(elapsed < 280, `不得把三源叠加到 3 倍，实际 ${elapsed}ms`)
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
      { name: 'a', fn: async () => { started.push('a'); return 'a' } },
      { name: 'b', fn: async () => { started.push('b'); return 'b' } },
    ])
    await assert.rejects(
      () => testApi.translateWithSources('hello', 'en', 'zh-CN', {
        shareBudget: true,
        getRemaining: () => 0,
      }),
      /超时/
    )
    assert.deepEqual(started, [])
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

  it('三源分别失败时错误带来源级安全诊断且不含 URL/代理地址', async () => {
    const e429 = new Error('HTTP 429')
    e429.statusCode = 429
    testApi.setTranslateSourcesForTest([
      { name: 'library', fn: async () => { throw new Error('请求超时') } },
      { name: 'gtx', fn: async () => { throw e429 } },
      { name: 'clients5', fn: async () => { throw new Error('响应解析失败') } },
    ])
    try {
      await services.googleTranslate('diag-text', 'en', 'zh-CN', 300)
      assert.fail('should throw')
    } catch (err) {
      assert.ok(Array.isArray(err.googleAttempts))
      assert.equal(err.googleAttempts.length, 3)
      assert.equal(err.googleAttempts[0].source, 'library')
      assert.equal(err.googleAttempts[0].category, 'timeout')
      assert.equal(err.googleAttempts[0].route, 'direct')
      assert.equal(err.googleAttempts[1].source, 'gtx')
      assert.equal(err.googleAttempts[1].statusCode, 429)
      assert.equal(err.googleAttempts[2].source, 'clients5')
      assert.equal(err.googleAttempts[2].category, 'parse_error')
      const blob = JSON.stringify(err.googleAttempts) + String(err.message || '')
      assert.equal(/https?:\/\//.test(blob), false)
      assert.equal(blob.includes('127.0.0.1'), false)
      assert.equal(blob.includes('diag-text'), false)
    }
  })

  it('429 不立即对同源连环重试，改为切下一源', async () => {
    const calls = []
    const e429 = new Error('HTTP 429')
    e429.statusCode = 429
    testApi.setTranslateSourcesForTest([
      { name: 'library', fn: async () => { calls.push('library'); throw e429 } },
      { name: 'gtx', fn: async () => { calls.push('gtx'); return 'ok-gtx' } },
    ])
    assert.equal(await services.googleTranslate('rate-limit', 'en', 'zh-CN', 200), 'ok-gtx')
    assert.deepEqual(calls, ['library', 'gtx'])
  })

  it('空译文不作为成功，继续后续源且不把空串写入缓存', async () => {
    let n = 0
    testApi.setTranslateSourcesForTest([
      { name: 'library', fn: async () => { n += 1; return '' } },
      { name: 'gtx', fn: async () => { n += 1; return 'ok-nonempty' } },
    ])
    assert.equal(await services.googleTranslate('empty-then-ok', 'en', 'zh-CN', 200), 'ok-nonempty')
    assert.equal(n, 2)
    assert.equal(await services.googleTranslate('empty-then-ok', 'en', 'zh-CN', 40), 'ok-nonempty')
    assert.equal(n, 2)
  })

  it('代理阶段挂起时仍尝试直连，总等待不超过预算', async () => {
    const started = []
    testApi.setTranslateSourcesForTest([
      {
        name: 'library',
        fn: async (_t, _f, _to, _ms, _s, tr) => {
          started.push(tr && tr.route)
          if (tr && tr.route === 'proxy') return hang()
          return 'direct-ok'
        },
      },
      {
        name: 'gtx',
        fn: async (_t, _f, _to, _ms, _s, tr) => {
          started.push('gtx-' + (tr && tr.route))
          return hang()
        },
      },
    ])
    const t0 = Date.now()
    const result = await services.googleTranslate('hello', 'en', 'zh-CN', 220, {
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:9',
    })
    const elapsed = Date.now() - t0
    assert.equal(result, 'direct-ok')
    assert.ok(started.includes('proxy'))
    assert.ok(started.includes('direct'))
    assert.ok(elapsed < 400, `代理+直连不得叠加成双倍预算，实际 ${elapsed}ms`)
  })

  it('代理配置不同的同文本不共享 inflight', async () => {
    const routes = []
    testApi.setTranslateSourcesForTest([
      {
        name: 'library',
        fn: async (_t, _f, _to, _ms, _s, tr) => {
          routes.push(tr && tr.route)
          await delay(40)
          return (tr && tr.route) + '-ok'
        },
      },
    ])
    const p1 = services.googleTranslate('same-route', 'en', 'zh-CN', 300)
    const p2 = services.googleTranslate('same-route', 'en', 'zh-CN', 300, {
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:9',
    })
    const [direct, proxied] = await Promise.all([p1, p2])
    assert.equal(direct, 'direct-ok')
    assert.equal(proxied, 'proxy-ok')
    assert.ok(routes.includes('direct'))
    assert.ok(routes.includes('proxy'))
  })

  it('非法或带凭据代理不启用，走直连', async () => {
    const routes = []
    testApi.setTranslateSourcesForTest([
      {
        name: 'library',
        fn: async (_t, _f, _to, _ms, _s, tr) => {
          routes.push(tr && tr.route)
          return 'ok'
        },
      },
    ])
    assert.equal(
      await services.googleTranslate('no-socks', 'en', 'zh-CN', 120, {
        proxyEnabled: true,
        proxyUrl: 'socks5://127.0.0.1:1080',
      }),
      'ok'
    )
    assert.equal(
      await services.googleTranslate('no-cred', 'en', 'zh-CN', 120, {
        proxyEnabled: true,
        proxyUrl: 'http://user:pass@127.0.0.1:8080',
      }),
      'ok'
    )
    assert.deepEqual(routes, ['direct', 'direct'])
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

describe('Google CONNECT 代理传输', () => {
  let services
  let testApi
  let proxy
  let connects
  let mode

  beforeEach(async () => {
    const loaded = loadServicesWithGoogleRequire(true)
    services = loaded.services
    testApi = loaded.testApi
    connects = []
    mode = 'fail'
    proxy = http.createServer((_req, res) => {
      res.writeHead(400)
      res.end()
    })
    proxy.on('connect', (req, clientSocket) => {
      connects.push(req.url)
      if (mode === 'hang') return
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      clientSocket.end()
    })
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    if (testApi) {
      testApi.restoreAllowedGoogleHosts()
      testApi.restoreTranslateSources()
      testApi.clearTranslateCache()
    }
    if (proxy) {
      await new Promise((resolve) => proxy.close(() => resolve()))
    }
  })

  function proxyUrl() {
    return `http://127.0.0.1:${proxy.address().port}`
  }

  it('启用代理时对允许的 Google 主机发出 CONNECT，失败后销毁连接', async () => {
    await assert.rejects(
      () => testApi.googleHttpRequest({
        url: 'https://translate.googleapis.com/translate_a/single?q=1',
        timeoutMs: 200,
        proxyUrl: proxyUrl(),
      }),
      /代理|超时|失败/
    )
    assert.ok(connects.some((item) => String(item).startsWith('translate.googleapis.com:443')))
    const blob = JSON.stringify(connects)
    assert.equal(blob.includes('?q='), false)
  })

  it('拒绝向非 Google 主机转发，不发出 CONNECT', async () => {
    await assert.rejects(
      () => testApi.googleHttpRequest({
        url: 'https://example.com/',
        timeoutMs: 120,
        proxyUrl: proxyUrl(),
      }),
      /不允许/
    )
    assert.deepEqual(connects, [])
  })

  it('代理 CONNECT 挂起不超过该段时限', async () => {
    mode = 'hang'
    const t0 = Date.now()
    await assert.rejects(
      () => testApi.googleHttpRequest({
        url: 'https://clients5.google.com/translate_a/t',
        timeoutMs: 70,
        proxyUrl: proxyUrl(),
      }),
      /超时/
    )
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 250, `CONNECT 挂起应被时限切断，实际 ${elapsed}ms`)
    assert.ok(connects.length >= 1)
  })
})
