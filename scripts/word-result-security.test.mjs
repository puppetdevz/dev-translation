import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { default: WordResult } = await server.ssrLoadModule('/src/Translate/components/WordResult.vue')
  const renderExample = (example, translation = 'hello') => renderToString(
    createSSRApp({
      render: () => h(WordResult, {
        result: { translation, definitions: [{ meaning: '示例', example }] },
        detectedLanguage: 'zh',
        settings: { showDefinitions: true, showExamples: true },
      }),
    }),
  )

  await test('外部例句 HTML 作为文本渲染，同时保留关键词高亮', async () => {
    const html = await renderExample('<img src=x onerror="window.__auditSentinel = true"> hello')
    assert.doesNotMatch(html, /<img\b/i)
    assert.match(html, /&lt;img/)
    assert.match(html, /<mark class="highlight"[^>]*>hello<\/mark>/)
  })

  await test('空关键词也不会把外部例句当 HTML 执行', async () => {
    const html = await renderExample('<svg onload="window.__auditSentinel = true"></svg>', '')
    assert.doesNotMatch(html, /<svg\b/i)
    assert.match(html, /&lt;svg/)
  })

  await test('关键词自身包含 HTML 时，高亮节点的内容仍安全', async () => {
    const keyword = '<img src=x onerror="window.__auditSentinel = true">'
    const html = await renderExample(`example ${keyword} & text`, keyword)
    assert.doesNotMatch(html, /<img\b/i)
    assert.match(html, /<mark class="highlight"[^>]*>&lt;img/)
    assert.match(html, /&amp; text/)
  })

  await test('含正则元字符的关键词按字面量、不区分大小写高亮', async () => {
    const html = await renderExample('A+B and a+b, not aaab', 'a+b')
    assert.match(html, /<mark class="highlight"[^>]*>A\+B<\/mark>/)
    assert.match(html, /<mark class="highlight"[^>]*>a\+b<\/mark>/)
    assert.doesNotMatch(html, /<mark class="highlight"[^>]*>aaab<\/mark>/)
  })
} finally {
  await server.close()
}
