import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeLogEntry, sanitizeLogList, formatSafeLogLine } from '../src/Translate/utils/safeLog.js'

const store = {}
globalThis.window = {
  utools: {
    dbStorage: {
      getItem(key) { return store[key] ?? null },
      setItem(key, value) { store[key] = value },
    },
  },
}

describe('sanitizeLogEntry', () => {
  it('丢弃原文、prompt、伪 Key、URL 查询和响应正文', () => {
    const entry = sanitizeLogEntry({
      id: '1',
      timestamp: 1,
      level: 'error',
      engine: 'thirdparty-ai',
      message: '失败: Hello secret-text',
      detail: JSON.stringify({
        text: '测试原文 hello world',
        prompt: 'Translate this: Hello',
        request: {
          url: 'https://api.example.com/v1/chat/completions?token=abc123',
          headers: { Authorization: 'Bearer sk-test-key-should-not-leak' },
          body: { messages: [{ role: 'user', content: '测试原文 hello world' }] },
        },
        response: { body: '{"secret":"from-server"}' },
      }),
    })
    const blob = JSON.stringify(entry)
    assert.equal(blob.includes('测试原文'), false)
    assert.equal(blob.includes('Translate this'), false)
    assert.equal(blob.includes('sk-test-key'), false)
    assert.equal(blob.includes('token=abc123'), false)
    assert.equal(blob.includes('from-server'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'detail'), false)
  })

  it('保留安全元数据：类别、状态码、阶段', () => {
    const entry = sanitizeLogEntry({
      id: '2',
      timestamp: 2,
      level: 'error',
      engine: 'ai',
      message: '上游返回 524（无响应体）',
      category: 'status_524',
      statusCode: 524,
      phase: 'call',
      requestId: 9,
    })
    assert.equal(entry.category, 'status_524')
    assert.equal(entry.statusCode, 524)
    assert.equal(entry.phase, 'call')
    assert.equal(entry.requestId, 9)
    assert.equal(entry.message.includes('524'), true)
  })

  it('含 TypeError / 堆栈的旧消息删除而非原样保留', () => {
    const entry = sanitizeLogEntry({
      id: '3',
      timestamp: 3,
      level: 'error',
      engine: 'thirdparty-ai',
      message: "Cannot read properties of undefined (reading 'requestThirdpartyAI')",
      detail: 'TypeError: Cannot read properties of undefined\n    at translateWithThirdpartyAI',
    })
    assert.equal(entry.message.includes('requestThirdpartyAI'), false)
    assert.equal(entry.message.includes('TypeError'), false)
    assert.equal(entry.detail, undefined)
  })
})

describe('sanitizeLogList / formatSafeLogLine', () => {
  it('复制出口不含历史敏感 detail', () => {
    const logs = sanitizeLogList([{
      id: '4',
      timestamp: 4,
      level: 'error',
      engine: 'google',
      message: 'HTTP 403: {"error":"leak"}',
      detail: 'q=测试原文&key=sk-abc',
      category: 'http_error',
      statusCode: 403,
    }])
    const text = logs.map(e => formatSafeLogLine(e, 't', '错误')).join('\n')
    assert.equal(text.includes('测试原文'), false)
    assert.equal(text.includes('sk-abc'), false)
    assert.equal(text.includes('leak'), false)
    assert.equal(text.includes('403'), true)
  })
})

describe('logger 读取时迁移旧记录', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    store['dev-translation-settings'] = JSON.stringify({ logLevel: 'error', logRetentionDays: 7 })
  })

  it('getLogs / formatLogsText 不会泄露旧 detail', async () => {
    store['dev-translation-logs'] = [{
      id: 'old',
      timestamp: Date.now(),
      level: 'error',
      engine: 'google',
      message: 'HTTP 401: {"token":"leak-token"}',
      detail: '原文=机密句子 prompt=Translate this URL=https://x.test/t?q=机密句子',
    }]
    const { getLogs, formatLogsText } = await import('../src/Translate/utils/logger.js')
    const logs = getLogs()
    const copied = formatLogsText()
    const persisted = store['dev-translation-logs']
    const blob = JSON.stringify(logs) + copied + JSON.stringify(persisted)
    assert.equal(blob.includes('leak-token'), false)
    assert.equal(blob.includes('机密句子'), false)
    assert.equal(blob.includes('Translate this'), false)
    assert.ok(Array.isArray(logs))
  })
})
