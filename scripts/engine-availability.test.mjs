import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_ENGINES,
  ENGINE_KIND,
  engineKind,
  engineKindLabel,
  defaultEngineEnabled,
  normalizeEngineEnabled,
  cloneEngineEnabled,
  isEngineEnabled,
  setEngineEnabled,
  isAllEnginesDisabled,
  getEnabledEngineOrder,
  getPrimaryEnabledEngine,
  getEnabledAiSources,
  composeOrderWithDisabled,
  rotateEnabledOrder,
  ensureFullKnownOrder,
} from '../src/Translate/utils/engineAvailability.js'

const ORDER = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun']

describe('固定类型元数据', () => {
  it('恰好八类引擎，两类 AI、六类 MT', () => {
    assert.deepEqual(KNOWN_ENGINES, ORDER)
    const ai = KNOWN_ENGINES.filter(e => engineKind(e) === 'ai')
    const mt = KNOWN_ENGINES.filter(e => engineKind(e) === 'mt')
    assert.deepEqual(ai, ['ai', 'thirdparty-ai'])
    assert.equal(mt.length, 6)
    assert.deepEqual(ai.map(engineKindLabel), ['AI', 'AI'])
    assert.ok(mt.every(e => engineKindLabel(e) === 'MT'))
  })
})

describe('normalizeEngineEnabled', () => {
  it('缺字段、非法值按 true 补齐，显式 false 保留，未知键忽略', () => {
    const map = normalizeEngineEnabled({ ai: false, google: 'no', unknown: false })
    assert.equal(map.ai, false)
    assert.equal(map.google, true)
    assert.equal(map['thirdparty-ai'], true)
    assert.equal('unknown' in map, false)
    assert.deepEqual(Object.keys(map).sort(), [...KNOWN_ENGINES].sort())
  })

  it('全 false 合法且不视为缺失', () => {
    const allOff = defaultEngineEnabled()
    for (const engine of KNOWN_ENGINES) allOff[engine] = false
    const normalized = normalizeEngineEnabled(allOff)
    assert.ok(isAllEnginesDisabled({ engineEnabled: normalized }))
    assert.ok(KNOWN_ENGINES.every(e => normalized[e] === false))
  })

  it('null / 数组 / 字符串回退为全部开启', () => {
    for (const raw of [null, undefined, [], 'nope', 5]) {
      const map = normalizeEngineEnabled(raw)
      assert.ok(KNOWN_ENGINES.every(e => map[e] === true), `raw=${String(raw)}`)
    }
  })

  it('clone 返回新对象，修改不影响源', () => {
    const source = defaultEngineEnabled()
    const copy = cloneEngineEnabled(source)
    copy.ai = false
    assert.equal(source.ai, true)
  })
})

describe('isEngineEnabled / setEngineEnabled', () => {
  it('映射缺失或值非法按开启处理', () => {
    assert.equal(isEngineEnabled({}, 'ai'), true)
    assert.equal(isEngineEnabled({ engineEnabled: null }, 'ai'), true)
    assert.equal(isEngineEnabled({ engineEnabled: { ai: 'off' } }, 'ai'), true)
    assert.equal(isEngineEnabled({ engineEnabled: { ai: false } }, 'ai'), false)
  })

  it('setEngineEnabled 只改目标键且不修改原映射', () => {
    const source = defaultEngineEnabled()
    const next = setEngineEnabled(source, 'google', false)
    assert.equal(next.google, false)
    assert.equal(source.google, true)
    assert.equal(next.ai, true)
  })
})

describe('有效顺序 / 主引擎 / AI 来源', () => {
  const settings = {
    failoverOrder: ORDER,
    engineEnabled: { ...defaultEngineEnabled(), ai: false, baidu: false },
  }

  it('按保存顺序过滤关闭项，不改写原数组', () => {
    assert.deepEqual(getEnabledEngineOrder(settings), ['thirdparty-ai', 'google', 'deepl', 'deeplx', 'aliyun', 'caiyun'])
    assert.deepEqual(settings.failoverOrder, ORDER)
  })

  it('首个开启项是主引擎，即使尚未配置；全关时为 null 而非 ai', () => {
    assert.equal(getPrimaryEnabledEngine(settings), 'thirdparty-ai')
    const allOff = defaultEngineEnabled()
    for (const engine of KNOWN_ENGINES) allOff[engine] = false
    assert.equal(getPrimaryEnabledEngine({ failoverOrder: ORDER, engineEnabled: allOff }), null)
  })

  it('AI 来源按有效顺序保持相对次序，MT 不入选', () => {
    assert.deepEqual(getEnabledAiSources(settings), ['thirdparty-ai'])
    assert.deepEqual(getEnabledAiSources({ failoverOrder: ORDER }), ['ai', 'thirdparty-ai'])
  })

  it('未知引擎标识被忽略', () => {
    assert.deepEqual(getEnabledEngineOrder({ failoverOrder: ['unknown', 'google', 'google'] }), ['google'])
  })
})

describe('composeOrderWithDisabled', () => {
  it('开启项排序结果在前，关闭项按原相对顺序接尾，不重不漏', () => {
    const settings = {
      failoverOrder: ORDER,
      engineEnabled: { ...defaultEngineEnabled(), ai: false, baidu: false },
    }
    const composed = composeOrderWithDisabled(['google', 'thirdparty-ai', 'deepl'], settings)
    assert.deepEqual(
      composed,
      ['google', 'thirdparty-ai', 'deepl', 'deeplx', 'aliyun', 'caiyun', 'ai', 'baidu'],
    )
    assert.equal(new Set(composed).size, composed.length)
    assert.ok(KNOWN_ENGINES.every(e => composed.includes(e)))
  })

  it('恢复关闭前的相对次序而非白名单顺序', () => {
    const settings = {
      failoverOrder: ['caiyun', 'ai', 'baidu', 'google'],
      engineEnabled: { ...defaultEngineEnabled(), ai: true, baidu: false, google: true, caiyun: false },
    }
    const composed = composeOrderWithDisabled(['google', 'ai'], settings)
    // 关闭项 caiyun 与 baidu 保持原顺序（caiyun 在 baidu 之前）接在末尾
    assert.deepEqual(composed.slice(0, 2), ['google', 'ai'])
    assert.deepEqual(composed.slice(2, 4), ['caiyun', 'baidu'])
  })
})

describe('rotateEnabledOrder', () => {
  it('仅一个开启项时不改顺序', () => {
    const settings = {
      failoverOrder: ORDER,
      engineEnabled: Object.fromEntries(KNOWN_ENGINES.map(e => [e, e === 'google'])),
    }
    assert.deepEqual(rotateEnabledOrder(settings), { order: ORDER, changed: false })
  })

  it('多项时只轮换开启项并填回原位置，关闭项保持原位', () => {
    const settings = {
      failoverOrder: ORDER,
      engineEnabled: { ...defaultEngineEnabled(), ai: false, deepl: false },
    }
    const { order, changed } = rotateEnabledOrder(settings)
    assert.equal(changed, true)
    // 开启项按位置轮转：thirdparty-ai → google → deeplx → baidu → aliyun → caiyun（首项移到末尾）
    assert.deepEqual(order, ['ai', 'google', 'deeplx', 'deepl', 'baidu', 'aliyun', 'caiyun', 'thirdparty-ai'])
    // 关闭项位置不变
    assert.equal(order[0], 'ai')
    assert.equal(order[3], 'deepl')
  })

  it('全关时不改顺序', () => {
    const settings = {
      failoverOrder: ORDER,
      engineEnabled: Object.fromEntries(KNOWN_ENGINES.map(e => [e, false])),
    }
    assert.deepEqual(rotateEnabledOrder(settings), { order: ORDER, changed: false })
  })
})

describe('ensureFullKnownOrder', () => {
  it('保留已有相对顺序，仅补齐缺失项', () => {
    assert.deepEqual(
      ensureFullKnownOrder(['google', 'ai', 'unknown']),
      ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun'],
    )
  })
})
