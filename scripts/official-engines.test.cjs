'use strict'

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const https = require('node:https')
const { EventEmitter } = require('node:events')

const {
  translateWithBaidu,
  translateWithAliyun,
  translateWithCaiyun,
  __test__: t,
} = require('../public/preload/officialEngines.js')

afterEach(() => {
  t.restoreRequestJson()
})

describe('语种映射', () => {
  it('将简中规范化为 zh，英语为 en', () => {
    assert.equal(t.mapToZhEn('zh-CN'), 'zh')
    assert.equal(t.mapToZhEn('zh'), 'zh')
    assert.equal(t.mapToZhEn('zh-Hans'), 'zh')
    assert.equal(t.mapToZhEn('en'), 'en')
    assert.equal(t.caiyunTransType('en', 'zh-CN'), 'en2zh')
    assert.equal(t.caiyunTransType('zh-CN', 'en'), 'zh2en')
  })
})

describe('百度签名与响应', () => {
  it('MD5(appid + q + salt + 密钥) 为小写十六进制，签名使用原文', () => {
    const sign = t.baiduSign('app', '你好 world', '123', 'secret')
    const expect = crypto.createHash('md5').update('app你好 world123secret', 'utf8').digest('hex')
    assert.equal(sign, expect)
    assert.equal(sign, sign.toLowerCase())
  })

  it('解析 trans_result，拒绝 error_code，且异常不含原文/密钥', () => {
    assert.equal(t.parseBaiduResponse({
      trans_result: [{ src: 'Hello', dst: '你好' }],
    }), '你好')
    assert.equal(t.parseBaiduResponse({
      trans_result: [{ dst: 'A' }, { dst: 'B' }],
    }), 'A\nB')
    assert.throws(() => t.parseBaiduResponse({
      error_code: '54001',
      error_msg: 'Invalid Sign: Hello secret-key',
    }), (err) => {
      const blob = String(err && err.message)
      assert.equal(blob.includes('Hello'), false)
      assert.equal(blob.includes('secret-key'), false)
      assert.equal(blob.includes('54001'), false)
      return true
    })
    assert.throws(() => t.parseBaiduResponse({ trans_result: [{ dst: '  ' }] }), /空/)
  })

  it('发送时对参数编码，签名字段仍是原文 MD5；成功返回译文', async () => {
    let captured
    t.setRequestJsonForTest(async (url, options) => {
      captured = { url, options }
      return { trans_result: [{ dst: '你好' }] }
    })
    const q = 'Hello & 世界'
    const result = await translateWithBaidu(q, 'en', 'zh-CN', 'app-id', 'app-secret', 80)
    assert.equal(result, '你好')
    assert.equal(captured.url, t.BAIDU_URL)
    assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded')
    const body = captured.options.body
    assert.equal(body.includes(q), false)
    assert.equal(body.includes('Hello%20%26%20'), true)
    const params = Object.fromEntries(new URLSearchParams(body))
    assert.equal(params.q, q)
    assert.equal(params.from, 'en')
    assert.equal(params.to, 'zh')
    assert.equal(params.appid, 'app-id')
    assert.equal(params.sign, t.baiduSign('app-id', q, params.salt, 'app-secret'))
    assert.equal(JSON.stringify(captured).includes('app-secret'), false)
  })
})

describe('阿里 ACS3 签名与响应', () => {
  it('官方固定参数示例可复现 Signature', () => {
    const signed = t.buildAcs3Auth({
      method: 'POST',
      canonicalUri: '/',
      query: {
        ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
        RegionId: 'cn-shanghai',
      },
      headers: {
        host: 'ecs.cn-shanghai.aliyuncs.com',
        'x-acs-action': 'RunInstances',
        'x-acs-date': '2023-10-26T10:22:32Z',
        'x-acs-signature-nonce': '3156853299f313e23d1673dc12e1703d',
        'x-acs-version': '2014-05-26',
      },
      body: '',
      accessKeyId: 'YourAccessKeyId',
      accessKeySecret: 'YourAccessKeySecret',
    })
    assert.equal(signed.signature, '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0')
    assert.equal(signed.authorization.includes('YourAccessKeySecret'), false)
  })

  it('TranslateGeneral 使用 form 体、ACS3 头，不以 HTTP 200 代替业务成功', async () => {
    let captured
    t.setRequestJsonForTest(async (url, options) => {
      captured = { url, options }
      return { Code: 200, Message: 'success', Data: { Translated: 'Hello' } }
    })
    const result = await translateWithAliyun('你好', 'zh-CN', 'en', 'akid', 'aksecret', 80)
    assert.equal(result, 'Hello')
    assert.equal(captured.url, t.ALIYUN_URL)
    const headers = captured.options.headers
    assert.equal(headers['x-acs-action'], 'TranslateGeneral')
    assert.equal(headers['x-acs-version'], '2018-10-12')
    assert.match(headers.Authorization, /^ACS3-HMAC-SHA256 /)
    assert.equal(headers.Authorization.includes('aksecret'), false)
    const body = captured.options.body
    assert.equal(body.includes('FormatType=text'), true)
    assert.equal(body.includes('Scene=general'), true)
    assert.equal(body.includes('SourceLanguage=zh'), true)
    assert.equal(body.includes('TargetLanguage=en'), true)
    assert.equal(JSON.stringify(captured).includes('aksecret'), false)

    assert.throws(() => t.parseAliyunResponse({
      Code: 10013,
      Message: '欠费 SourceText=机密',
    }), (err) => {
      const blob = String(err && err.message)
      assert.equal(blob.includes('机密'), false)
      assert.equal(blob.includes('欠费'), false)
      return true
    })
    assert.throws(() => t.parseAliyunResponse({ Code: 200, Data: { Translated: '' } }), /空/)
  })
})

describe('彩云响应', () => {
  it('提取 target，业务错误不含 Token/原文', async () => {
    assert.equal(t.parseCaiyunResponse({ target: '你好' }), '你好')
    assert.equal(t.parseCaiyunResponse({ target: ['你', '好'] }), '你\n好')
    assert.throws(() => t.parseCaiyunResponse({
      message: 'invalid token abc',
      error: 'auth',
    }), (err) => {
      const blob = String(err && err.message)
      assert.equal(blob.includes('abc'), false)
      assert.equal(blob.includes('token'), false)
      return true
    })

    let captured
    t.setRequestJsonForTest(async (url, options) => {
      captured = { url, options }
      return { target: 'Hello' }
    })
    const result = await translateWithCaiyun('你好', 'zh-CN', 'en', 'user-token', 80)
    assert.equal(result, 'Hello')
    assert.equal(captured.url, t.CAIYUN_URL)
    assert.equal(captured.options.headers['X-Authorization'], 'token user-token')
    const payload = JSON.parse(captured.options.body)
    assert.equal(payload.trans_type, 'zh2en')
    assert.equal(payload.detect, false)
    assert.equal(payload.source, '你好')
  })
})

describe('preload 官方引擎请求约束', () => {
  it('HTTPS 请求超时取消连接、HTTP/解析错误只给安全异常', async () => {
    const originalRequest = https.request
    let destroyed = 0
    const captures = []
    let responseMode = 'hang'
    https.request = (opts, callback) => {
      captures.push(opts)
      const req = new EventEmitter()
      req.write = () => {}
      req.destroy = () => { destroyed += 1 }
      req.end = () => {
        if (responseMode === 'hang') return
        queueMicrotask(() => {
          const res = new EventEmitter()
          res.statusCode = responseMode === '401' ? 401 : 200
          callback(res)
          res.emit('data', responseMode === '401' ? '{"error":"secret-text"}' : 'not-json-secret')
          res.emit('end')
        })
      }
      return req
    }
    try {
      await assert.rejects(
        () => translateWithCaiyun('secret-text', 'en', 'zh-CN', 'secret-token', 25),
        (err) => err.category === 'timeout' && !String(err.message).includes('secret'),
      )
      assert.equal(destroyed, 1)
      assert.equal(captures[0].hostname, 'api.interpreter.caiyunai.com')
      assert.equal(captures[0].port, 443)
      responseMode = '401'
      await assert.rejects(
        () => translateWithBaidu('secret-text', 'en', 'zh-CN', 'appid', 'key', 80),
        (err) => err.statusCode === 401 && !String(err.message).includes('secret'),
      )
      responseMode = 'invalid-json'
      await assert.rejects(
        () => translateWithAliyun('secret-text', 'en', 'zh-CN', 'id', 'key', 80),
        (err) => err.category === 'parse_error' && !String(err.message).includes('secret'),
      )
      assert.deepEqual(captures.map(item => item.hostname), [
        'api.interpreter.caiyunai.com',
        'fanyi-api.baidu.com',
        'mt.aliyuncs.com',
      ])
    } finally {
      https.request = originalRequest
    }
  })

  it('即使绕过渲染层，也在底层请求前拒绝超长文本，彩云不加阈值', async () => {
    const calls = []
    t.setRequestJsonForTest(async (url) => {
      calls.push(url)
      return { target: '你好' }
    })
    await assert.rejects(
      () => translateWithBaidu('😀'.repeat(1001), 'en', 'zh-CN', 'id', 'secret', 30),
      (err) => err.category === 'input_limit',
    )
    await assert.rejects(
      () => translateWithAliyun('x'.repeat(5001), 'en', 'zh-CN', 'id', 'secret', 30),
      (err) => err.category === 'input_limit',
    )
    assert.deepEqual(calls, [])
    assert.equal(await translateWithCaiyun('x'.repeat(6000), 'en', 'zh-CN', 'token', 30), '你好')
    assert.deepEqual(calls, [t.CAIYUN_URL])
  })

  it('缺凭据不发请求；异常不含凭据/原文/URL', async () => {
    let called = 0
    t.setRequestJsonForTest(async () => {
      called += 1
      return {}
    })
    await assert.rejects(() => translateWithBaidu('hi', 'en', 'zh-CN', '', 's', 20))
    await assert.rejects(() => translateWithAliyun('hi', 'en', 'zh-CN', 'id', '', 20))
    await assert.rejects(() => translateWithCaiyun('hi', 'en', 'zh-CN', '  ', 20))
    assert.equal(called, 0)
  })
})
