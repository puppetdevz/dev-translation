import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compile, nextTick, proxyRefs, reactive } from 'vue'
import { runVueScript } from './helpers/vue-script-harness.mjs'

const file = new URL('../src/Translate/components/SettingsPage.vue', import.meta.url)
const source = readFileSync(file, 'utf8')

async function fixture() {
  const listeners = new Map()
  const mounted = []
  let observer
  let writes = 0
  const settings = reactive({ failoverOrder: ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun'] })
  const window = {
    innerWidth: 1000,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) },
  }
  const app = await runVueScript(file, {
    window,
    bindings: {
      useSettings: () => ({ settings, updateSetting(key, value) { writes++; settings[key] = value; return true }, toggleSetting() {} }),
      onMounted: fn => mounted.push(fn),
      ResizeObserver: class {
        constructor(callback) { this.callback = callback; observer = this }
        observe(element) { this.element = element }
        disconnect() { this.disconnected = true }
      },
    },
    expose: [
      'settings', 'engineMeta', 'mainEngine', 'selectedEngine', 'selectedEngineEnabled', 'activeCategory',
      'selectEngine', 'toggleEngineEnabled', 'isEngineEnabled', 'officialEngineConfigured',
      'dragIndex', 'dragOverIndex', 'dragOverPos', 'onDragStart', 'onDragOver', 'onDrop', 'onDragEnd',
      'ENGINE_LIST_MIN_WIDTH', 'engineLayout', 'engineListWidth', 'engineListMaxWidth', 'resizingEngineList',
      'syncEngineLayoutWidth', 'startEngineListResize', 'resizeEngineList', 'stopEngineListResize', 'onEngineSplitterKeydown',
    ],
  })
  let width = 900
  app.state.engineLayout.value = { getBoundingClientRect: () => ({ width }) }
  app.state.syncEngineLayoutWidth()
  const event = (x, extra = {}) => ({ clientX: x, pointerId: 7, button: 0, preventDefault() {}, ...extra })
  return { ...app, window, listeners, event,
    mountLayout() { mounted[0](); return observer },
    get writes() { return writes },
    setWidth(value) { width = value; app.state.syncEngineLayoutWidth() },
  }
}

describe('引擎列表可调宽度', () => {
  it('分隔条有键盘与可访问语义，状态位于名称外、P 序号左侧且不换行', () => {
    assert.match(source, /role="separator"/)
    assert.match(source, /aria-orientation="vertical"/)
    assert.match(source, /@pointerdown="startEngineListResize"/)
    assert.match(source, /@keydown="onEngineSplitterKeydown"/)
    const card = source.slice(source.indexOf('<div class="engine-card-info">'), source.indexOf('<span class="engine-priority">'))
    assert.match(card, /<\/div>\s*<div[^>]*class="engine-card-meta">/, '状态不能嵌套在名称下方')
    const metaStyle = source.match(/\.engine-card-meta\s*\{([^}]+)\}/)[1]
    assert.match(metaStyle, /flex-wrap:\s*nowrap/)
    assert.match(source, /\.engine-list-splitter\s*\{[^}]*display:\s*none/s)
  })

  it('指针拖动受左右宽度边界约束，结束后释放监听且不改排序设置', async () => {
    const app = await fixture()
    try {
      const { state, event, listeners } = app
      assert.equal(state.engineListWidth.value, 280)
      state.startEngineListResize(event(300))
      assert.equal(state.resizingEngineList.value, true)
      assert.equal(listeners.size, 4)
      state.resizeEngineList(event(350, { pointerId: 99 }))
      assert.equal(state.engineListWidth.value, 280, '忽略其他指针')
      state.resizeEngineList(event(350))
      assert.equal(state.engineListWidth.value, 330)
      state.resizeEngineList(event(9999))
      assert.equal(state.engineListWidth.value, 420)
      state.resizeEngineList(event(-9999))
      assert.equal(state.engineListWidth.value, 240)
      listeners.get('pointerup')(event(100))
      assert.equal(state.resizingEngineList.value, false)
      assert.equal(listeners.size, 0)
      assert.equal(app.writes, 0, '调宽不持久化、不改顺序或引擎开关')
    } finally { app.dispose() }
  })

  it('监听布局变化，切到窄窗时中止在途拖动，卸载断开观察器', async () => {
    const app = await fixture()
    const observer = app.mountLayout()
    assert.equal(observer.element, app.state.engineLayout.value)
    assert.equal(app.listeners.has('resize'), true)
    app.state.startEngineListResize(app.event(300))
    app.window.innerWidth = 640
    observer.callback()
    assert.equal(app.state.resizingEngineList.value, false)
    assert.equal(app.listeners.has('pointermove'), false)
    app.dispose()
    assert.equal(observer.disconnected, true)
    assert.equal(app.listeners.size, 0)
  })

  it('窗口收缩重新限制宽度，窄窗不拖动，取消/失焦/卸载清理监听', async () => {
    const app = await fixture()
    const { state, event, listeners } = app
    state.startEngineListResize(event(300))
    state.resizeEngineList(event(440))
    app.setWidth(600)
    assert.equal(state.engineListMaxWidth.value, 304)
    assert.equal(state.engineListWidth.value, 304)
    listeners.get('pointercancel')(event(440))
    assert.equal(listeners.size, 0)
    state.startEngineListResize(event(300, { button: 2 }))
    assert.equal(listeners.size, 0)
    state.startEngineListResize(event(300))
    listeners.get('blur')()
    assert.equal(listeners.size, 0)
    app.window.innerWidth = 640
    state.startEngineListResize(event(300))
    assert.equal(listeners.size, 0)
    app.window.innerWidth = 1000
    state.startEngineListResize(event(300))
    app.dispose()
    assert.equal(listeners.size, 0)
  })

  it('第二个指针按下不能抢走当前拖动的所有权', async () => {
    const app = await fixture()
    try {
      const { state, event } = app
      state.startEngineListResize(event(300))
      state.startEngineListResize(event(310, { pointerId: 99 }))
      state.resizeEngineList(event(350))
      assert.equal(state.engineListWidth.value, 330, '原指针应继续控制拖动')
      state.stopEngineListResize(event(350, { pointerId: 99 }))
      assert.equal(state.resizingEngineList.value, true, '其他指针释放不能终止原指针拖动')
      state.stopEngineListResize(event(350))
      assert.equal(state.resizingEngineList.value, false)
    } finally { app.dispose() }
  })

  it('容器在拖动中收缩后，下一次指针位移从当前可见宽度继续', async () => {
    const app = await fixture()
    try {
      const { state, event } = app
      state.onEngineSplitterKeydown({ key: 'End', preventDefault() {} })
      state.startEngineListResize(event(500))
      state.resizeEngineList(event(510))
      app.setWidth(600)
      assert.equal(state.engineListWidth.value, 304)
      state.resizeEngineList(event(500))
      assert.equal(state.engineListWidth.value, 294, '向左移动 10px 应立即缩小，而非困在旧锚点死区')
      app.setWidth(900)
      state.resizeEngineList(event(501))
      assert.equal(state.engineListWidth.value, 295, '扩窗不能恢复过时起始宽度')
      assert.equal(app.writes, 0)
    } finally { app.dispose() }
  })

  it('切离引擎分类即停止拖动，返回后不恢复在途监听', async () => {
    const app = await fixture()
    try {
      app.state.activeCategory.value = 'engine'
      await nextTick()
      app.state.startEngineListResize(app.event(300))
      app.state.activeCategory.value = 'general'
      await nextTick()
      assert.equal(app.state.resizingEngineList.value, false)
      assert.equal(app.listeners.has('pointermove'), false)
      app.state.activeCategory.value = 'engine'
      await nextTick()
      assert.equal(app.state.resizingEngineList.value, false)
    } finally { app.dispose() }
  })

  it('键盘可选择任一引擎，再由详情唯一开关启停，不修改顺序', async () => {
    const app = await fixture()
    try {
      const template = source.slice(source.indexOf('<!-- 左列：引擎列表'), source.indexOf('<!-- 右列：选中引擎'))
      const render = compile(template)
      const cards = []
      const visit = node => {
        if (!node || typeof node !== 'object') return
        if (node.props?.class?.includes('engine-card ') || node.props?.class === 'engine-card') cards.push(node)
        if (Array.isArray(node.children)) node.children.forEach(visit)
      }
      visit(render(proxyRefs(app.state), []))
      assert.equal(cards.length, 8)
      const order = [...app.state.settings.failoverOrder]
      for (const [index, card] of cards.entries()) {
        assert.equal(Number(card.props.tabindex), 0, '每张引擎卡片必须可由 Tab 到达')
        assert.equal(card.props.role, 'button')
        assert.ok(card.props['aria-label'].includes(app.state.engineMeta[order[index]].name))
        assert.equal(card.props['aria-describedby'], `settings-engine-status-${order[index]}`)
        assert.equal(card.children.find(node => node.props?.class === 'engine-card-meta').props.id, card.props['aria-describedby'])
        for (const key of ['Enter', ' ']) {
          let prevented = false
          const event = { key, preventDefault() { prevented = true } }
          const handlers = card.props.onKeydown
          for (const handler of Array.isArray(handlers) ? handlers : [handlers]) handler(event)
          await nextTick()
          assert.equal(prevented, true, 'Space 不得滚动面板')
          assert.equal(app.state.selectedEngine.value, order[index])
          assert.equal(app.writes, index, '选择只改变编辑焦点，不写配置')
        }
        app.state.toggleEngineEnabled(app.state.selectedEngine.value)
        assert.equal(app.state.selectedEngineEnabled.value, false)
      }
      assert.deepEqual([...app.state.settings.failoverOrder], order)
      assert.equal(app.writes, 8)
      assert.match(source, /\.engine-card:focus-visible\s*\{/)
    } finally { app.dispose() }
  })

  it('键盘方向键调宽、Home/End 到边界，不处理无关键', async () => {
    const app = await fixture()
    try {
      const { state } = app
      let prevented = 0
      const key = key => state.onEngineSplitterKeydown({ key, preventDefault() { prevented++ } })
      key('ArrowRight')
      assert.equal(state.engineListWidth.value, 290)
      key('ArrowLeft')
      assert.equal(state.engineListWidth.value, 280)
      key('End')
      assert.equal(state.engineListWidth.value, 420)
      key('Home')
      assert.equal(state.engineListWidth.value, 240)
      key('Tab')
      assert.equal(prevented, 4)
    } finally { app.dispose() }
  })
})
