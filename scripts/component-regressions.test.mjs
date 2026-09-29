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
