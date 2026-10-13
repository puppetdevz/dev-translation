import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// The project has no DOM test runner; check the actual Vue call sites, not a stand-in helper.
const settingsPage = readFileSync(new URL('../src/Translate/components/SettingsPage.vue', import.meta.url), 'utf8')
const translatePage = readFileSync(new URL('../src/Translate/index.vue', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `missing section: ${start}`)
  return source.slice(from, to)
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
  it('设置页引擎行提供独立开关、固定类型标签与有效主引擎标识', () => {
    const card = between(settingsPage, 'class="engine-card"', 'class="engine-priority"')
    assert.match(card, /engine-enable-toggle/)
    assert.match(card, /@click\.stop="toggleEngineEnabled\(engine\)"/)
    assert.match(card, /aria-pressed/)
    assert.match(card, /engine-kind-tag/)
    assert.match(card, /主引擎/)
    assert.match(settingsPage, /engine-disabled-warning/)
    assert.match(settingsPage, /无启用引擎/)
  })

  it('开关拖动不得进入卡片拖拽排序', () => {
    const dragStart = between(settingsPage, 'const onDragStart =', 'const onDragOver =')
    assert.match(dragStart, /engine-enable-toggle/)
    assert.match(dragStart, /preventDefault\(\)/)
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
