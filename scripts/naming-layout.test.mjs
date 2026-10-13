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

const baseSettings = {
  showPhonetic: true,
  showDefinitions: true,
  showPartOfSpeech: true,
  showExamples: true,
  showVariableNaming: true,
  showAiNaming: false,
  showContextNote: true,
}

try {
  const { default: VariableNaming } = await server.ssrLoadModule('/src/Translate/components/VariableNaming.vue')
  const { default: WordResult } = await server.ssrLoadModule('/src/Translate/components/WordResult.vue')

  const renderNaming = (props) => renderToString(createSSRApp({ render: () => h(VariableNaming, props) }))
  const renderWord = (result, settings, dictionaryStatus, ai = {}) => renderToString(createSSRApp({
    render: () => h(WordResult, {
      result,
      originalText: result.translation,
      detectedLanguage: 'en',
      settings,
      dictionaryStatus,
      aiNamingStatus: ai.aiStatus || 'off',
      aiNamingWords: ai.aiWords || [],
      aiNamingMessage: ai.aiMessage || '',
    }),
  }))

  await test('两行布局：常规命名与 AI 命名各一行，标签同行滚动', async () => {
    const html = await renderNaming({
      englishText: 'parallel',
      enabled: true,
      aiEnabled: true,
      aiStatus: 'ready',
      aiWords: ['discovery', 'count'],
    })
    assert.match(html, /常规命名/)
    assert.match(html, /AI 命名/)
    assert.match(html, /parallel/)
    assert.match(html, /discoveryCount/)
    assert.match(html, /class="naming-tags"/)
    // 每行最多 5 个标签，且同一语义名称派生出 5 种格式
    assert.equal((html.match(/class="naming-tag"/g) || []).length, 10)
    assert.match(html, /UPPER_CASE/)
    assert.match(html, /kebab-case/)
  })

  await test('AI 行独立于常规行：常规词元为空也保留 AI 行', async () => {
    const html = await renderNaming({
      englishText: '   ',
      enabled: true,
      aiEnabled: true,
      aiStatus: 'ready',
      aiWords: ['is', 'loaded'],
    })
    assert.doesNotMatch(html, /常规命名/)
    assert.match(html, /AI 命名/)
    assert.match(html, /isLoaded/)
  })

  await test('常规行关闭、AI 开启时仍显示 AI 行；都关闭时不显示命名区', async () => {
    const aiOnly = await renderNaming({ englishText: 'parallel', enabled: false, aiEnabled: true, aiStatus: 'loading' })
    assert.doesNotMatch(aiOnly, /常规命名/)
    assert.match(aiOnly, /AI 命名生成中…/)

    const none = await renderNaming({ englishText: 'parallel', enabled: false, aiEnabled: false, aiStatus: 'off' })
    assert.doesNotMatch(none, /变量命名|常规命名|AI 命名/)
  })

  await test('AI 状态提示：无需命名、无来源、失败与超时都可重试', async () => {
    const none = await renderNaming({ englishText: 'x', enabled: false, aiEnabled: true, aiStatus: 'none', aiWords: [] })
    assert.match(none, /无需变量命名/)
    assert.doesNotMatch(none, /重试/)

    const unconfigured = await renderNaming({ englishText: 'x', enabled: false, aiEnabled: true, aiStatus: 'unconfigured', aiMessage: '未配置可用的 AI 来源，请在设置中检查已有 AI 配置与顺序' })
    assert.match(unconfigured, /未配置可用的 AI 来源/)

    for (const status of ['failed', 'timeout', 'stale']) {
      const html = await renderNaming({ englishText: 'x', enabled: false, aiEnabled: true, aiStatus: status })
      assert.match(html, /重试/)
    }

    const tooLong = await renderNaming({ englishText: 'x', enabled: false, aiEnabled: true, aiStatus: 'too-long' })
    assert.match(tooLong, /输入过长，暂不生成 AI 命名/)
  })

  await test('标签为可聚焦按钮，title 提供完整值，数值为原始名称', async () => {
    const html = await renderNaming({
      englishText: 'configuration settings manager factory',
      enabled: true,
      aiEnabled: false,
      aiStatus: 'off',
    })
    assert.match(html, /<button[^>]*type="button"[^>]*title="configurationSettingsManagerFactory"/)
    assert.match(html, /configurationSettingsManagerFactory/)
    // 复制值不含格式名、省略号或行标题
    assert.doesNotMatch(html, /title="camelCase: /)
  })

  await test('词性开关：关闭只隐藏标签，含义保留；关闭释义时整块隐藏且无「暂无词性」', async () => {
    const result = { translation: '平行的', definitions: [{ pos: 'adj.', meaning: '平行的' }] }
    const withPos = await renderWord(result, baseSettings, { phonetic: 'available', definitions: 'available' })
    assert.match(withPos, /class="pos-tag"/)

    const withoutPos = await renderWord(result, { ...baseSettings, showPartOfSpeech: false }, { phonetic: 'available', definitions: 'available' })
    assert.doesNotMatch(withoutPos, /class="pos-tag"/)
    assert.match(withoutPos, /平行的/)

    const withoutDefinitions = await renderWord(result, { ...baseSettings, showDefinitions: false }, { phonetic: 'available', definitions: 'hidden' })
    assert.doesNotMatch(withoutDefinitions, /class="pos-tag"/)
    assert.doesNotMatch(withoutDefinitions, /暂无词性/)
  })

  await test('词典字段缺失提示与加载提示', async () => {
    const loading = await renderWord({ translation: 'parallel' }, baseSettings, { phonetic: 'loading', definitions: 'loading' })
    assert.match(loading, /音标补全中…/)
    assert.match(loading, /释义补全中…/)

    const missing = await renderWord({ translation: 'parallel' }, baseSettings, { phonetic: 'unavailable', definitions: 'unavailable' })
    assert.match(missing, /暂无音标/)
    assert.match(missing, /暂无释义/)

    const hiddenPhonetic = await renderWord({ translation: 'parallel' }, { ...baseSettings, showPhonetic: false }, { phonetic: 'hidden', definitions: 'unavailable' })
    assert.doesNotMatch(hiddenPhonetic, /音标补全中…/)
    assert.doesNotMatch(hiddenPhonetic, /暂无音标/)
  })

  await test('WordResult 传递 AI 行状态并显示重试入口', async () => {
    const html = await renderWord(
      { translation: 'parallel' },
      { ...baseSettings, showAiNaming: true },
      { phonetic: 'available', definitions: 'available' },
      { aiStatus: 'timeout' },
    )
    assert.match(html, /AI 命名超时/)
    assert.match(html, /重试/)
  })
} finally {
  await server.close()
}
