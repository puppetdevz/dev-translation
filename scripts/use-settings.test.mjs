import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const store = {}
let failSave = false
globalThis.window = {
  utools: {
    dbStorage: {
      getItem(key) { return store[key] ?? null },
      setItem(key, value) {
        if (failSave) return false
        store[key] = value
      },
    },
  },
}

const { useSettings } = await import('../src/Translate/utils/useSettings.js')

describe('useSettings 保存反馈', () => {
  it('成功排序立即更新共享设置、落盘重载后仍保留；失败不虚报已保存', () => {
    const a = useSettings()
    const b = useSettings()
    const order = ['google', 'ai', 'thirdparty-ai', 'deepl', 'deeplx']
    assert.equal(a.updateSetting('failoverOrder', order), true)
    assert.deepEqual(b.settings.failoverOrder, order)
    assert.deepEqual(JSON.parse(store['dev-translation-settings']).failoverOrder, order)

    failSave = true
    const newOrder = ['ai', 'google', 'thirdparty-ai', 'deepl', 'deeplx']
    assert.equal(a.updateSetting('failoverOrder', newOrder), false)
    assert.deepEqual(b.settings.failoverOrder, newOrder, '会话中顺序仍立即生效')
    assert.deepEqual(JSON.parse(store['dev-translation-settings']).failoverOrder, order, '重载后仍是旧顺序')
    failSave = false
  })
})
