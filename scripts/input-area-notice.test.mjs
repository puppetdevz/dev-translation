import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compile, createSSRApp } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

const { descriptor } = parse(readFileSync(new URL('../src/Translate/components/InputArea.vue', import.meta.url), 'utf8'))
const render = compile(descriptor.template.content)

it('已有翻译引擎标签不能遮住当前 AI 检测降级提示', async () => {
  const notice = 'AI 语言检测不可用，已按本地规则判断方向'
  const app = createSSRApp({
    render,
    setup: () => ({
      text: 'Fixture text.', modelValue: 'Fixture text.', charCount: 13,
      detectedLanguage: 'en', languageIndicator: '英 → 中', isManualOverride: false,
      isDetectingPlaceholder: false, isLoading: false, isPolishing: false, polishedText: '',
      usedEngineLabel: 'Google', detectionNotice: notice, textareaRef: null,
      handleClear() {}, handlePolish() {}, handleTranslate() {}, handleAcceptPolish() {},
      handleRejectPolish() {}, handleKeydown() {}, emit() {},
    }),
  })
  const html = await renderToString(app)
  assert.match(html, /class="detection-notice"/)
  assert.ok(html.includes(notice))
  assert.match(html, /role="status"/)
  assert.doesNotMatch(html, /class="used-engine-badge"/, '窄窗口优先显示当前提示，不并排挤压按钮')
})
