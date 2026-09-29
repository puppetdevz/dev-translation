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
  snapshotThirdpartyAiTimeoutMs,
  snapshotEngineTimeoutMs,
} = await import('../src/Translate/utils/storage.js')
const {
  inspectEngine,
  runEngineFailover,
  SKIP_REASON,
  ERROR_CATEGORY,
} = await import('../src/Translate/utils/engineBridge.js')
const {
  normalizeThirdpartyAiGroups,
  migrateLegacyThirdpartyAiGroup,
  runThirdpartyAiGroupFailover,
  inspectThirdpartyAiGroup,
  snapshotThirdpartyAiGroups,
  generateUniqueGroupName,
  createGroupRequest,
  MIGRATED_GROUP_ID,
  DEFAULT_GROUP_ID,
} = await import('../src/Translate/utils/thirdpartyAiGroups.js')
const { sanitizeLogEntry } = await import('../src/Translate/utils/safeLog.js')

const STORAGE_KEY = 'dev-translation-settings'

function hang() {
  return new Promise(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const PRELOAD_SERVICES = {
  googleTranslate: async () => 'ok',
  deeplTranslate: async () => 'ok',
  deeplxTranslate: async () => 'ok',
  requestThirdpartyAI: async () => ({ choices: [{ message: { content: 'ok' } }] }),
}

const READY_ENV = {
  services: PRELOAD_SERVICES,
  utools: { ai: async () => ({}) },
}

function group(partial) {
  return {
    id: 'g_a',
    name: '自定义 AI 1',
    url: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'm',
    ...partial,
  }
}

describe('自定义 AI 组迁移与持久化', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('新安装默认一个空组，二级超时默认 5 秒', () => {
    const s = loadSettings()
    assert.equal(s.thirdpartyAiGroups.length, 1)
    assert.equal(s.thirdpartyAiGroups[0].id, DEFAULT_GROUP_ID)
    assert.equal(s.thirdpartyAiGroups[0].url, '')
    assert.equal(s.thirdpartyAiGroups[0].apiKey, '')
    assert.equal(s.thirdpartyAiGroups[0].model, '')
    assert.equal(s.thirdpartyAiFailoverTimeoutSeconds, 5)
    assert.equal(DEFAULT_SETTINGS.thirdpartyAiUrl, undefined)
  })

  it('旧单套 URL/Key/模型迁为第一组且保留共用提示词、一级顺序与一级超时', () => {
    store[STORAGE_KEY] = JSON.stringify({
      thirdpartyAiUrl: 'https://old.example/v1',
      thirdpartyAiKey: 'sk-old',
      thirdpartyAiModel: 'gpt-old',
      thirdpartyAiSystemPrompt: 'be concise',
      failoverOrder: ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx'],
      engineResponseTimeoutSeconds: 12,
    })
    const s = loadSettings()
    assert.equal(s.thirdpartyAiGroups.length, 1)
    assert.equal(s.thirdpartyAiGroups[0].id, MIGRATED_GROUP_ID)
    assert.equal(s.thirdpartyAiGroups[0].url, 'https://old.example/v1')
    assert.equal(s.thirdpartyAiGroups[0].apiKey, 'sk-old')
    assert.equal(s.thirdpartyAiGroups[0].model, 'gpt-old')
    assert.equal(s.thirdpartyAiSystemPrompt, 'be concise')
    assert.deepEqual(s.failoverOrder, ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun'])
    assert.equal(s.engineResponseTimeoutSeconds, 12)
    assert.equal(s.thirdpartyAiUrl, undefined)
    assert.equal(s.thirdpartyAiKey, undefined)
    assert.equal(s.thirdpartyAiModel, undefined)
  })

  it('未填满的旧字段也不丢失；重复加载得到同一迁移组 ID', () => {
    store[STORAGE_KEY] = JSON.stringify({
      thirdpartyAiUrl: 'https://partial.example/v1',
      thirdpartyAiKey: '',
      thirdpartyAiModel: 'only-model',
    })
    const a = loadSettings()
    const b = loadSettings()
    assert.equal(a.thirdpartyAiGroups[0].url, 'https://partial.example/v1')
    assert.equal(a.thirdpartyAiGroups[0].model, 'only-model')
    assert.equal(a.thirdpartyAiGroups[0].apiKey, '')
    assert.equal(a.thirdpartyAiGroups[0].id, b.thirdpartyAiGroups[0].id)
    assert.equal(a.thirdpartyAiGroups[0].id, MIGRATED_GROUP_ID)
  })

  it('明确持久化的零组不会在下次加载被补回', () => {
    const current = loadSettings()
    current.thirdpartyAiGroups = []
    assert.equal(saveSettings(current), true)
    const loaded = loadSettings()
    assert.deepEqual(loaded.thirdpartyAiGroups, [])
    const persisted = JSON.parse(store[STORAGE_KEY])
    assert.deepEqual(persisted.thirdpartyAiGroups, [])
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'thirdpartyAiUrl'), false)
  })

  it('保存后不再写入旧三字段，重复保存不复制组', () => {
    store[STORAGE_KEY] = JSON.stringify({
      thirdpartyAiUrl: 'https://old.example/v1',
      thirdpartyAiKey: 'sk-old',
      thirdpartyAiModel: 'm',
    })
    const s = loadSettings()
    assert.equal(saveSettings(s), true)
    const persisted = JSON.parse(store[STORAGE_KEY])
    assert.equal(persisted.thirdpartyAiUrl, undefined)
    assert.equal(persisted.thirdpartyAiGroups.length, 1)
    const again = loadSettings()
    assert.equal(saveSettings(again), true)
    assert.equal(JSON.parse(store[STORAGE_KEY]).thirdpartyAiGroups.length, 1)
  })

  it('二级超时 1/60 可保存；0、小数、61、空值回退 5', () => {
    for (const value of [1, 60]) {
      const current = loadSettings()
      current.thirdpartyAiFailoverTimeoutSeconds = value
      assert.equal(saveSettings(current), true)
      assert.equal(loadSettings().thirdpartyAiFailoverTimeoutSeconds, value)
    }
    for (const raw of [0, 5.5, 61, '', null, 'nope']) {
      store[STORAGE_KEY] = JSON.stringify({
        thirdpartyAiGroups: [],
        thirdpartyAiFailoverTimeoutSeconds: raw,
      })
      assert.equal(loadSettings().thirdpartyAiFailoverTimeoutSeconds, 5)
      assert.deepEqual(loadSettings().thirdpartyAiGroups, [])
    }
  })

  it('损坏的组数据不会让加载崩溃，并去掉重复 ID/名称', () => {
    store[STORAGE_KEY] = JSON.stringify({
      thirdpartyAiGroups: [
        { id: 'g_dup', name: 'A', url: 'u1', apiKey: 'k1', model: 'm1' },
        { id: 'g_dup', name: 'A', url: 'u2', apiKey: 'k2', model: 'm2' },
        null,
        'bad',
      ],
    })
    const s = loadSettings()
    assert.equal(s.thirdpartyAiGroups.length, 2)
    assert.equal(s.thirdpartyAiGroups[0].id, 'g_dup')
    assert.notEqual(s.thirdpartyAiGroups[1].id, 'g_dup')
    assert.notEqual(s.thirdpartyAiGroups[1].name, 'A')
  })
})

describe('组名与快照', () => {
  it('空名生成不重名名称', () => {
    assert.equal(generateUniqueGroupName([]), '自定义 AI 1')
    assert.equal(generateUniqueGroupName(['自定义 AI 1', '自定义 AI 2']), '自定义 AI 3')
  })

  it('snapshot 后改原数组不影响已取出的组', () => {
    const settings = { thirdpartyAiGroups: [group({ apiKey: 'sk-1' })] }
    const snap = snapshotThirdpartyAiGroups(settings)
    settings.thirdpartyAiGroups[0].apiKey = 'sk-changed'
    assert.equal(snap[0].apiKey, 'sk-1')
  })

  it('normalize 空数组保持为空', () => {
    assert.deepEqual(normalizeThirdpartyAiGroups([]), [])
    assert.equal(migrateLegacyThirdpartyAiGroup({ thirdpartyAiKey: 'k' })[0].id, MIGRATED_GROUP_ID)
  })
})

describe('组预检与二级编排', () => {
  it('缺 URL/Key/模型的组跳过且不发请求', async () => {
    const calls = []
    const out = await runThirdpartyAiGroupFailover({
      groups: [
        group({ url: '' }),
        group({ id: 'g_b', name: 'B', apiKey: '  ' }),
        group({ id: 'g_c', name: 'C', model: '' }),
      ],
      timeoutMs: 80,
      env: READY_ENV,
      requestGroup: async (g) => {
        calls.push(g.id)
        return { translation: 'nope' }
      },
    })
    assert.equal(out.success, false)
    assert.equal(out.allSkipped, true)
    assert.equal(calls.length, 0)
    assert.ok(out.outcomes.every(o => o.status === 'skipped'))
    assert.ok(out.outcomes.every(o => o.skipReason === SKIP_REASON.NOT_CONFIGURED))
  })

  it('桥接缺失时各组按环境跳过', async () => {
    const calls = []
    const out = await runThirdpartyAiGroupFailover({
      groups: [group({ id: 'g_a' }), group({ id: 'g_b', name: 'B' })],
      timeoutMs: 80,
      env: { services: undefined, utools: {} },
      requestGroup: async (g) => {
        calls.push(g.id)
        return { translation: 'nope' }
      },
    })
    assert.equal(out.allSkipped, true)
    assert.equal(calls.length, 0)
    assert.ok(out.outcomes.every(o => o.skipReason === SKIP_REASON.BRIDGE_MISSING))
  })

  it('组 1 的 524 立即尝试组 2，不调用组 3', async () => {
    const calls = []
    const out = await runThirdpartyAiGroupFailover({
      groups: [
        group({ id: 'g_1', name: '一' }),
        group({ id: 'g_2', name: '二', url: 'https://b.example/v1' }),
        group({ id: 'g_3', name: '三', url: 'https://c.example/v1' }),
      ],
      timeoutMs: 200,
      env: READY_ENV,
      requestGroup: async (g) => {
        calls.push(g.id)
        if (g.id === 'g_1') {
          const err = new Error('524 status code (no body)')
          err.statusCode = 524
          throw err
        }
        return { translation: `ok-${g.id}` }
      },
    })
    assert.deepEqual(calls, ['g_1', 'g_2'])
    assert.equal(out.success, true)
    assert.equal(out.groupId, 'g_2')
    assert.equal(out.groupIndex, 1)
    assert.equal(out.result.translation, 'ok-g_2')
    assert.equal(out.outcomes[0].category, ERROR_CATEGORY.STATUS_524)
  })

  it('空结果与不可用译文对象不计成功，继续下一组', async () => {
    const calls = []
    const out = await runThirdpartyAiGroupFailover({
      groups: [group({ id: 'g_1' }), group({ id: 'g_2', name: '二' })],
      timeoutMs: 80,
      env: READY_ENV,
      requestGroup: async (g) => {
        calls.push(g.id)
        if (g.id === 'g_1') return { translation: '   ' }
        return { translation: 'hello' }
      },
    })
    assert.deepEqual(calls, ['g_1', 'g_2'])
    assert.equal(out.success, true)
    assert.equal(out.groupId, 'g_2')
    assert.equal(out.outcomes[0].category, ERROR_CATEGORY.EMPTY_RESULT)
  })

  it('前组超时后下一组获得完整二级预算；迟到结果不覆盖', async () => {
    let resolveLate
    const late = new Promise(resolve => { resolveLate = resolve })
    const started = {}
    const out = await runThirdpartyAiGroupFailover({
      groups: [group({ id: 'g_1' }), group({ id: 'g_2', name: '二' })],
      timeoutMs: 50,
      env: READY_ENV,
      requestGroup: async (g) => {
        started[g.id] = Date.now()
        if (g.id === 'g_1') return late
        return { translation: 'second' }
      },
    })
    resolveLate({ translation: 'late-first' })
    await delay(20)
    assert.equal(out.success, true)
    assert.equal(out.result.translation, 'second')
    assert.equal(out.groupId, 'g_2')
    assert.ok(started.g_2 - started.g_1 >= 40)
    assert.equal(out.outcomes.filter(o => o.status === 'success').length, 1)
  })

  it('零组时 allSkipped，inspect 一级引擎为跳过', () => {
    const settings = { thirdpartyAiGroups: [] }
    const r = inspectEngine('thirdparty-ai', settings, READY_ENV)
    assert.equal(r.status, 'skipped')
    assert.equal(r.skipReason, SKIP_REASON.NOT_CONFIGURED)
  })

  it('至少一组就绪则一级引擎 ready', () => {
    const settings = { thirdpartyAiGroups: [group({ url: '' }), group({ id: 'g_b', name: 'B' })] }
    assert.equal(inspectEngine('thirdparty-ai', settings, READY_ENV).status, 'ready')
    assert.equal(inspectThirdpartyAiGroup(group({ apiKey: '' }), READY_ENV).status, 'skipped')
  })
})

describe('一级时限不得截断自定义 AI 组链', () => {
  it('一级 40ms、二级 80ms：前组挂起、后组成功，整链不被一级截断', async () => {
    const calls = []
    const t0 = Date.now()
    const settings = {
      thirdpartyAiGroups: [group({ id: 'g_1' }), group({ id: 'g_2', name: '二' })],
      thirdpartyAiFailoverTimeoutSeconds: 1,
    }
    const out = await runEngineFailover({
      order: ['thirdparty-ai', 'google'],
      settings,
      env: READY_ENV,
      timeoutMs: 40,
      translateWith: async (engine) => {
        if (engine !== 'thirdparty-ai') return { translation: 'google-should-not' }
        const chain = await runThirdpartyAiGroupFailover({
          groups: settings.thirdpartyAiGroups,
          timeoutMs: 80,
          env: READY_ENV,
          requestGroup: async (g) => {
            calls.push(g.id)
            if (g.id === 'g_1') return hang()
            return { translation: 'from-g2' }
          },
        })
        if (!chain.success) throw new Error(chain.message || 'fail')
        return chain.result
      },
      isCurrent: () => true,
    })
    const elapsed = Date.now() - t0
    assert.equal(out.success, true)
    assert.equal(out.engine, 'thirdparty-ai')
    assert.equal(out.result.translation, 'from-g2')
    assert.deepEqual(calls, ['g_1', 'g_2'])
    assert.ok(elapsed >= 70, `应走完组 1 的二级时限，实际 ${elapsed}ms`)
    assert.ok(elapsed < 400, `不应再叠加一级时限，实际 ${elapsed}ms`)
  })

  it('两组都失败才进入下一一级引擎', async () => {
    const engines = []
    const out = await runEngineFailover({
      order: ['thirdparty-ai', 'google'],
      settings: { thirdpartyAiGroups: [group({ id: 'g_1' }), group({ id: 'g_2', name: '二' })] },
      env: READY_ENV,
      timeoutMs: 80,
      translateWith: async (engine) => {
        engines.push(engine)
        if (engine === 'thirdparty-ai') {
          const chain = await runThirdpartyAiGroupFailover({
            groups: [group({ id: 'g_1' }), group({ id: 'g_2', name: '二' })],
            timeoutMs: 40,
            env: READY_ENV,
            requestGroup: async () => {
              throw new Error('HTTP 500')
            },
          })
          const err = new Error(chain.message || 'fail')
          throw err
        }
        return { translation: 'google-ok' }
      },
      isCurrent: () => true,
    })
    assert.deepEqual(engines, ['thirdparty-ai', 'google'])
    assert.equal(out.engine, 'google')
    assert.equal(out.fallback, true)
  })
})

describe('组标识进入日志白名单且不含组名/Key', () => {
  it('保留安全 groupId/groupIndex，丢弃组名与 Key', () => {
    const entry = sanitizeLogEntry({
      id: '1',
      timestamp: 1,
      level: 'error',
      engine: 'thirdparty-ai',
      message: '引擎请求超时',
      category: 'timeout',
      groupId: 'g_ab12',
      groupIndex: 1,
      groupName: '生产 Key 组',
      apiKey: 'sk-secret',
    })
    const blob = JSON.stringify(entry)
    assert.equal(entry.groupId, 'g_ab12')
    assert.equal(entry.groupIndex, 1)
    assert.equal(blob.includes('生产 Key 组'), false)
    assert.equal(blob.includes('sk-secret'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'groupName'), false)
  })

  it('非法 groupId（含用户组名）不得写入日志', () => {
    const entry = sanitizeLogEntry({
      id: '2',
      timestamp: 2,
      level: 'error',
      engine: 'thirdparty-ai',
      message: '引擎调用失败',
      groupId: '生产环境',
      groupIndex: 0,
    })
    assert.equal(entry.groupId, undefined)
    assert.equal(entry.groupIndex, 0)
  })
})

describe('createGroupRequest 系统提示词范围', () => {
  it('配置测试默认不发送 system；正式翻译可追加共用提示词', async () => {
    const captured = []
    const env = {
      services: {
        requestThirdpartyAI: async (url, key, body) => {
          captured.push(body.messages.map(m => m.role))
          return { choices: [{ message: { content: 'ok' } }] }
        },
      },
    }
    const probe = createGroupRequest({
      env,
      includeSystemPrompt: false,
      systemPrompt: 'secret prompt',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await probe(group({}), 100)
    const translate = createGroupRequest({
      env,
      includeSystemPrompt: true,
      systemPrompt: 'secret prompt',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await translate(group({}), 100)
    const empty = createGroupRequest({
      env,
      includeSystemPrompt: true,
      systemPrompt: '  ',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await empty(group({}), 100)
    assert.deepEqual(captured[0], ['user'])
    assert.deepEqual(captured[1], ['system', 'user'])
    assert.deepEqual(captured[2], ['user'])
  })
})

describe('snapshotThirdpartyAiTimeoutMs', () => {
  it('与一级超时相互独立', () => {
    const settings = {
      engineResponseTimeoutSeconds: 1,
      thirdpartyAiFailoverTimeoutSeconds: 8,
    }
    assert.equal(snapshotEngineTimeoutMs(settings), 1000)
    assert.equal(snapshotThirdpartyAiTimeoutMs(settings), 8000)
    assert.equal(snapshotThirdpartyAiTimeoutMs({ thirdpartyAiFailoverTimeoutSeconds: 61 }), 5000)
  })
})
