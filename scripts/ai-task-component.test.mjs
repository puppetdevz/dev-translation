import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reactive, nextTick } from 'vue'
import { runVueScript } from './helpers/vue-script-harness.mjs'
import { DEFAULT_SETTINGS } from '../src/Translate/utils/storage.js'
import { cloneEngineEnabled } from '../src/Translate/utils/engineAvailability.js'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const GROUP = { id: 'g_test', name: 'test', url: 'https://test.example/v1', apiKey: 'fixture', model: 'fixture' }
async function page(t, { ai = async () => ({ content: 'en' }), services = {}, overrides = {} } = {}) {
  const settings = reactive({
    ...DEFAULT_SETTINGS,
    engineEnabled: cloneEngineEnabled(DEFAULT_SETTINGS.engineEnabled),
    failoverOrder: [...DEFAULT_SETTINGS.failoverOrder],
    thirdpartyAiGroups: [],
    ...overrides,
  })
  const window = { utools: { ai }, services }
  const previousWindow = globalThis.window
  globalThis.window = window
  t.after(() => { globalThis.window = previousWindow })
  const harness = await runVueScript(new URL('../src/Translate/index.vue', import.meta.url), {
    window,
    bindings: {
      useSettings: () => ({ settings, toggleSetting() {}, updateSetting(key, value) { settings[key] = value; return true } }),
      logger: { warn() {}, error() {}, info() {}, debug() {} },
      recordEngineResult() {},
    },
    expose: ['inputText', 'detectedLanguage', 'isManualOverride', 'isPolishing', 'polishedText', 'originalText',
      'detectionNotice', 'error', 'translationResult', 'polish', 'translate', 'handleClear', 'handleLanguageToggle', 'handleLanguageRedetect'],
  })
  t.after(() => harness.dispose())
  harness.state.inputText.value = 'Original text.'
  await nextTick()
  return { ...harness, settings }
}

describe('润色页面在途状态', () => {
  for (const action of ['edit', 'clear', 'toggle', 'redetect']) {
    it(`${action} 使旧润色失效，同时释放 loading 并允许重新润色`, async t => {
      const old = deferred()
      let calls = 0
      const p = await page(t, { ai: () => ++calls === 1 ? old.promise : Promise.resolve({ content: 'New result.' }) })
      const pending = p.state.polish()
      await Promise.resolve()
      assert.equal(p.state.isPolishing.value, true)
      if (action === 'edit') p.state.inputText.value = 'Edited text.'
      if (action === 'clear') p.state.handleClear()
      if (action === 'toggle') p.state.handleLanguageToggle()
      if (action === 'redetect') p.state.handleLanguageRedetect()
      await nextTick()
      assert.equal(p.state.isPolishing.value, false, '失效操作必须主动释放 loading，不能依赖旧 finally')
      old.resolve({ content: 'Obsolete result.' })
      await pending
      assert.equal(p.state.polishedText.value, '')
      p.state.inputText.value = 'Retry text.'
      await nextTick()
      await p.state.polish()
      assert.equal(p.state.polishedText.value, 'New result.')
      assert.equal(p.state.isPolishing.value, false)
    })
  }

  it('自动检测改变方向也会释放旧润色，不能采纳旧方向结果', async t => {
    const old = deferred()
    const p = await page(t, { ai: () => old.promise })
    p.state.detectedLanguage.value = 'en'
    const pending = p.state.polish()
    await Promise.resolve()
    p.state.detectedLanguage.value = 'zh'
    await nextTick()
    assert.equal(p.state.isPolishing.value, false)
    old.resolve({ content: 'Obsolete.' })
    await pending
    assert.equal(p.state.polishedText.value, '')
  })

  it('修改输入后同一 tick 启动的新润色不能被延迟 watcher 作废', async t => {
    const p = await page(t, { ai: async () => ({ content: 'Fresh.' }) })
    p.state.inputText.value = 'New input.'
    await p.state.polish()
    assert.equal(p.state.polishedText.value, 'Fresh.')
    assert.equal(p.state.isPolishing.value, false)
  })

  it('旧 finally 不得清除新轮次 loading', async t => {
    const old = deferred()
    const fresh = deferred()
    let calls = 0
    const p = await page(t, { ai: () => ++calls === 1 ? old.promise : fresh.promise })
    const first = p.state.polish()
    await Promise.resolve()
    p.state.inputText.value = 'Changed.'
    await nextTick()
    const second = p.state.polish()
    await Promise.resolve()
    old.resolve({ content: 'Old.' })
    await first
    assert.equal(p.state.isPolishing.value, true)
    fresh.resolve({ content: 'Fresh.' })
    await second
    assert.equal(p.state.polishedText.value, 'Fresh.')
    assert.equal(p.state.isPolishing.value, false)
  })

  it('引擎开关改变不丢弃在途润色，后续来源按旧快照继续', async t => {
    const old = deferred()
    let groupCalls = 0
    const p = await page(t, {
      ai: () => old.promise,
      services: { requestThirdpartyAI: async () => { groupCalls++; return { choices: [{ message: { content: 'Fallback.' } }] } } },
      overrides: { thirdpartyAiGroups: [GROUP] },
    })
    const pending = p.state.polish()
    await Promise.resolve()
    p.settings.engineEnabled = Object.fromEntries(Object.keys(p.settings.engineEnabled).map(k => [k, false]))
    await nextTick()
    old.resolve({ content: '' })
    await pending
    assert.equal(groupCalls, 1)
    assert.equal(p.state.polishedText.value, 'Fallback.')
  })
})

describe('语言检测失效边界', () => {
  for (const started of [false, true]) {
    it(`手动切方向取消${started ? '在途' : '防抖中'}检测，旧响应不覆盖且不提示`, async t => {
      const old = deferred()
      let calls = 0
      const p = await page(t, { ai: () => { calls++; return old.promise }, overrides: { detectionStrategy: 'ai' } })
      p.state.detectedLanguage.value = 'en'
      let pending
      if (started) { pending = p.fireTimers(500); await Promise.resolve() }
      p.state.handleLanguageToggle()
      assert.equal(p.state.detectedLanguage.value, 'zh')
      old.resolve({ content: 'en' })
      if (pending) await pending
      else await p.fireTimers(500)
      assert.equal(p.state.detectedLanguage.value, 'zh', '手动方向不能被旧自动检测覆盖')
      assert.equal(p.state.detectionNotice.value, '')
      assert.equal(calls, started ? 1 : 0)
    })
  }

  it('改为纯空白使在途检测失效，不能回填旧语言或提示', async t => {
    const old = deferred()
    const p = await page(t, { ai: () => old.promise, overrides: { detectionStrategy: 'ai' } })
    const pending = p.fireTimers(500)
    await Promise.resolve()
    p.state.inputText.value = '   '
    await nextTick()
    old.resolve({ content: '' })
    await pending
    assert.equal(p.state.detectedLanguage.value, '')
    assert.equal(p.state.detectionNotice.value, '')
  })
})

describe('主翻译配置快照', () => {
  for (const engine of ['deepl', 'deeplx']) {
    it(`回退到 ${engine} 时使用启动时的凭据，而非在途新配置`, async t => {
      const first = deferred()
      let seen
      const p = await page(t, {
        services: {
          googleTranslate: () => first.promise,
          deeplTranslate: async (...args) => { seen = args.slice(3, 4); return '完成' },
          deeplxTranslate: async (...args) => { seen = args.slice(3, 5); return '完成' },
        },
        overrides: { failoverOrder: ['google', engine], deeplApiKey: 'old-key', deeplxServerUrl: 'https://old.example', deeplxToken: 'old-token' },
      })
      const pending = p.state.translate()
      await Promise.resolve()
      p.settings.deeplApiKey = 'new-key'
      p.settings.deeplxServerUrl = 'https://new.example'
      p.settings.deeplxToken = 'new-token'
      first.resolve('')
      await pending
      assert.deepEqual(seen, engine === 'deepl' ? ['old-key'] : ['https://old.example', 'old-token'])
      assert.ok(p.state.translationResult.value)
    })
  }
})
