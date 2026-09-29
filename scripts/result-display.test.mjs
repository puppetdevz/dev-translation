import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { default: ResultDisplay } = await server.ssrLoadModule('/src/Translate/components/ResultDisplay.vue')
  const settings = {
    showPhonetic: true,
    showDefinitions: true,
    showExamples: true,
    showVariableNaming: true,
    showContextNote: true,
  }
  const renderResult = (inputType, result, originalText, detectedLanguage) => renderToString(
    createSSRApp({ render: () => h(ResultDisplay, { result, inputType, originalText, detectedLanguage, settings }) }),
  )

  test('开启变量命名时，句子翻译结果保留译文并显示命名样式', async () => {
    const html = await renderResult('sentence', { translation: 'user profile settings page' }, '用户个人资料设置页面', 'zh')
    assert.match(html, /user profile settings page/)
    assert.match(html, /变量命名/)
    assert.match(html, /userProfileSettingsPage/)
  })

  test('英译中句子由英文原文生成合法变量名，关闭开关则不显示', async () => {
    const result = { translation: '你好世界' }
    const html = await renderResult('sentence', result, 'Hello, world!', 'en')
    assert.match(html, /helloWorld/)
    settings.showVariableNaming = false
    try {
      const hidden = await renderResult('sentence', result, 'Hello, world!', 'en')
      assert.doesNotMatch(hidden, /变量命名/)
    } finally {
      settings.showVariableNaming = true
    }
  })

  test('句子结果若包含音标和语境说明，开启显示时应呈现', async () => {
    const html = await renderResult('sentence', { translation: 'hello world', phonetic: '/həˈləʊ/', contextNote: '用于问候' }, 'hello world', 'en')
    assert.match(html, /həˈləʊ/)
    assert.match(html, /用于问候/)
  })

  test('单词翻译结果显示音标和变量命名', async () => {
    const html = await renderResult('word', { translation: 'hello world', phonetic: '/həˈləʊ/' }, 'hello world', 'en')
    assert.match(html, /həˈləʊ/)
    assert.match(html, /变量命名/)
  })
} finally {
  await server.close()
}
