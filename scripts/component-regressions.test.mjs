import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { compile, createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

// The project has no DOM test runner; check the actual Vue call sites, not a stand-in helper.
const settingsPage = readFileSync(new URL('../src/Translate/components/SettingsPage.vue', import.meta.url), 'utf8')
const translatePage = readFileSync(new URL('../src/Translate/index.vue', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `missing section: ${start}`)
  return source.slice(from, to)
}

// 用真实模板片段渲染，验证结构而不是重复手写标记。
async function renderTemplate(template, state) {
  const render = compile(template)
  const app = createSSRApp({ render, setup: () => state })
  return renderToString(app)
}

describe('设置页异步及测试结果回归', () => {
  it('更改组凭据应解锁模型拉取，并继续忽略旧请求', () => {
    const invalidation = between(settingsPage, 'const bumpGroupAsync =', 'const patchGroup =')
    const ui = { fetchGen: 1, testGen: 0, fetching: true, models: ['旧模型'], error: '', testResult: null }
    const invalidate = runInNewContext(`(() => { ${invalidation}; return bumpGroupAsync })()`, {
      ensureGroupUi: () => ui,
    })
    const staleGen = ui.fetchGen
    invalidate('g_test')
    assert.equal(ui.fetchGen, staleGen + 1)
    assert.equal(ui.fetching, false, '编辑配置后应该可以立即用新凭据重新获取模型')
    assert.deepEqual(Array.from(ui.models), [])
    const fetch = between(settingsPage, 'const handleFetchModels =', 'const selectModel =')
    assert.match(fetch, /if \(ui\.fetchGen !== gen\) return/)
    assert.match(fetch, /if \(ui\.fetchGen === gen\) ui\.fetching = false/)
  })

  it('单组与自定义 AI 连接测试只报告成功，不回显第三方响应', () => {
    const groupTest = between(settingsPage, 'const runGroupTest =', '// DeepL API Key')
    assert.doesNotMatch(groupTest, /连接正常[^`]*\$\{(?:text|result)\}/)
    const engineTest = between(settingsPage, 'const runEngineTest =', 'const probeGuard =')
    assert.doesNotMatch(engineTest, /连接正常[^`]*\$\{result\}/)
    assert.match(groupTest, /连接正常/)
    assert.match(engineTest, /连接正常/)
  })
})

describe('官方引擎开通入口', () => {
  it('阿里云机器翻译链接应打开可用的官方产品页', () => {
    const signup = between(settingsPage, 'const openAliyunSignup =', 'const openCaiyunSignup =')
    assert.match(settingsPage, /@click="openAliyunSignup">开通阿里云机器翻译<\/a>/)
    let openedUrl = ''
    const open = runInNewContext(`(() => { ${signup}; return openAliyunSignup })()`, {
      window: { utools: { shellOpenExternal: url => { openedUrl = url } } },
    })
    open()
    assert.equal(openedUrl, 'https://www.aliyun.com/product/ai/alimt')
  })

  it('阿里云 AccessKey 入口应直达 RAM 用户管理而非主账号密钥页', () => {
    const aliyunConfig = between(settingsPage, "selectedEngine === 'aliyun'", "selectedEngine === 'caiyun'")
    assert.match(aliyunConfig, /@click="openAliyunAccessKeys">前往 RAM 用户管理<\/a>/)
    assert.match(aliyunConfig, /选择用户 → 凭证管理 → 创建 AccessKey（Secret 仅创建时可见，勿使用主账号密钥）/)
    const handler = between(settingsPage, 'const openAliyunAccessKeys =', 'const openCaiyunSignup =')
    let openedUrl = ''
    const open = runInNewContext(`(() => { ${handler}; return openAliyunAccessKeys })()`, {
      window: { utools: { shellOpenExternal: url => { openedUrl = url } } },
    })
    open()
    assert.equal(openedUrl, 'https://ram.console.aliyun.com/users')
  })
})

describe('翻译请求晚到保护', () => {
  it('卸载翻译页时使当前请求失效，避免离页后回写和结算', () => {
    const teardown = between(translatePage, 'onUnmounted(() => {', '\n})')
    assert.match(teardown, /translateRequestId\s*\+\+/)
  })
})

describe('引擎开关接入回归', () => {
  it('列表卡片不含开关与类型标签，详情标题栏提供唯一开关', () => {
    const card = between(settingsPage, 'class="engine-card"', 'class="engine-priority"')
    assert.match(card, /主引擎/)
    assert.match(card, /已关闭/)
    assert.doesNotMatch(card, /engine-enable-toggle/)
    assert.doesNotMatch(card, /engine-kind-tag/)
    assert.doesNotMatch(card, /toggleEngineEnabled/)
    assert.doesNotMatch(settingsPage, /engineKindLabel/)

    const header = between(settingsPage, 'class="engine-config-header"', 'engine-config-warning')
    assert.equal((header.match(/toggle-switch engine-enable-toggle/g) || []).length, 1)
    assert.match(header, /@click="toggleEngineEnabled\(selectedEngine\)"/)
    assert.match(header, /aria-pressed="selectedEngineEnabled/)
    assert.match(header, /aria-labelledby="`engine-config-name-\$\{selectedEngine\} engine-enable-label-\$\{selectedEngine\}`"/)
    assert.match(header, /启用引擎/)
    assert.doesNotMatch(header, /mainEngine/, '开关不得绑定有效主引擎')
    assert.ok(
      header.indexOf('engine-enable-control') < header.indexOf('engine-test-btn'),
      '启用引擎控件应位于「测试配置」左侧'
    )
    assert.match(settingsPage, /engine-disabled-warning/)
    assert.match(settingsPage, /无启用引擎/)
  })

  it('右侧启停只改开关映射，列表拖拽仍按原规则排序', () => {
    const dragStart = between(settingsPage, 'const onDragStart =', 'const onDragOver =')
    assert.doesNotMatch(dragStart, /engine-enable-toggle/)
    assert.match(dragStart, /dragIndex\.value = index/)

    const toggle = between(settingsPage, 'const toggleEngineEnabled =', 'const selectEngine =')
    assert.match(toggle, /setEngineEnabled\(settings\.engineEnabled, engine, !isEngineEnabled\(settings, engine\)\)/)
    assert.match(toggle, /persistSetting\('engineEnabled', next\)/)
    assert.doesNotMatch(toggle, /failoverOrder/)
    assert.doesNotMatch(toggle, /selectedEngine/, '切开关不得切换编辑焦点')

    assert.match(settingsPage, /const onDrop = \(index\) =>/)
    assert.match(settingsPage, /updateSetting\('failoverOrder', newOrder\)/)
  })

  it('真实列表模板渲染八张卡片时不输出开关与类型标签', async () => {
    const engines = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun']
    const html = await renderTemplate(between(settingsPage, '<!-- 左列：引擎列表', '<!-- 右列'), {
      engineMeta: Object.fromEntries(engines.map(e => [e, { name: `引擎-${e}`, icon: '🌐' }])),
      settings: { failoverOrder: engines },
      mainEngine: 'ai',
      isEngineEnabled: (_settings, engine) => engine !== 'deepl',
      officialEngineConfigured: engine => engine !== 'baidu',
      selectedEngine: 'ai',
      dragIndex: null,
      dragOverIndex: null,
      dragOverPos: null,
      selectEngine() {},
      onDragStart() {},
      onDragOver() {},
      onDrop() {},
      onDragEnd() {},
    })

    assert.equal((html.match(/engine-drag-handle/g) || []).length, 8, '八张卡片保留拖拽柄')
    assert.doesNotMatch(html, /engine-enable-toggle/, '列表不再输出开关')
    assert.doesNotMatch(html, /toggle-switch/, '列表不再输出任何滑动开关')
    assert.doesNotMatch(html, /engine-kind-tag/, '列表不再输出 AI/MT 标签')
    assert.equal((html.match(/engine-primary-tag/g) || []).length, 1, '仅主引擎带标识')
    assert.equal((html.match(/engine-card-off/g) || []).length, 1, '关闭项保留已关闭状态')
    assert.equal((html.match(/engine-card-unconfigured/g) || []).length, 1, '未配置状态保留')
    for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']) assert.ok(html.includes(`>${p}<`), `缺少 ${p} 序号`)
  })

  it('详情标题栏开关跟随编辑焦点并在测试按钮左侧', async () => {
    const engines = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun']
    const engineMeta = Object.fromEntries(engines.map(e => [e, { name: `引擎-${e}`, icon: '🌐' }]))
    const template = between(settingsPage, '<div class="engine-config-header">', '<div v-if="!selectedEngineEnabled"')
    const render = async state => renderTemplate(template, {
      engineMeta,
      selectedEngine: state.engine,
      selectedEngineEnabled: state.enabled,
      testingEngine: '',
      testingGroupId: '',
      runEngineTest() {},
      toggleEngineEnabled() {},
    })

    const closed = await render({ engine: 'baidu', enabled: false })
    assert.equal((closed.match(/toggle-switch engine-enable-toggle/g) || []).length, 1, '详情只有一个引擎开关')
    assert.match(closed, /aria-pressed="false"/)
    assert.match(closed, /aria-labelledby="engine-config-name-baidu engine-enable-label-baidu"/)
    assert.match(closed, /id="engine-enable-label-baidu"[^>]*>启用引擎</)
    assert.ok(closed.indexOf('engine-enable-control') < closed.indexOf('engine-test-btn'), '开关位于测试配置左侧')
    assert.match(closed, /引擎-baidu/)
    assert.doesNotMatch(closed, /engine-kind-tag/)

    const opened = await render({ engine: 'google', enabled: true })
    assert.match(opened, /aria-pressed="true"/)
    assert.match(opened, /aria-labelledby="engine-config-name-google engine-enable-label-google"/)
    assert.match(opened, /引擎-google/)
    assert.doesNotMatch(opened, /百度/)
  })

  it('全部关闭时批量测试与保存失败文案符合约定', () => {
    const probe = between(settingsPage, 'const runBatchProbe =', 'const dragIndex =')
    assert.match(probe, /getEnabledEngineOrder\(settings\)\.length === 0/)
    assert.match(probe, /NO_ENABLED_ENGINE_MESSAGE/)
    assert.match(settingsPage, /保存失败，重启后可能恢复原状态/)
  })

  it('翻译页按有效顺序启动，全关不发请求', () => {
    const translateFn = between(translatePage, 'const translate = async () =>', 'const dismissFallbackNotice =')
    assert.match(translateFn, /getEnabledEngineOrder\(settings\)/)
    assert.match(translateFn, /NO_ENABLED_ENGINE_MESSAGE/)
    assert.match(translateFn, /order\.length === 0/)
  })

  it('检测与润色走共享辅助 AI 回退并做版本保护', () => {
    assert.match(translatePage, /runAiTaskFailover/)
    assert.match(translatePage, /buildLanguageDetectionMessages/)
    assert.match(translatePage, /polishVersion/)
    assert.match(translatePage, /getEnabledAiSources/)
  })

  it('快捷轮换只动开启项，全关时进入设置的引擎分类', () => {
    const toggle = between(translatePage, 'const toggleTranslationEngine =', '// 主引擎 → 简短标签')
    assert.match(toggle, /rotateEnabledOrder/)
    assert.match(toggle, /openSettingsEngine\(\)/)
    const opener = between(translatePage, 'const openSettingsEngine =', 'const toggleTranslationEngine =')
    assert.match(opener, /category: 'engine'/)
  })
})
