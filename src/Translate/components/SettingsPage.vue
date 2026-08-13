<script setup>
import { computed, ref, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '../utils/useSettings.js'
import { copyText } from '../utils/clipboard.js'
import { getLogs, clearLogs, getLogCount, formatLogsText } from '../utils/logger.js'
import { LOG_LEVEL_OPTIONS, LOG_RETENTION_OPTIONS, levelLabel } from '../utils/logConstants.js'
import { getEngineStats, clearEngineStats, computeStability, ENGINE_STATS_RECENT_WINDOW } from '../utils/engineStats.js'

const router = useRouter()
const { settings, updateSetting, toggleSetting } = useSettings()

const handleBack = () => {
  router.push({ name: 'translate' })
}

const handleStrategySelect = (strategy) => {
  updateSetting('detectionStrategy', strategy)
}

const engineMeta = {
  ai: { icon: '⚡', name: 'uTools AI' },
  'thirdparty-ai': { icon: '🧠', name: '自定义 AI' },
  google: { brand: 'G', brandClass: 'brand-google', name: 'Google' },
  deepl: { brand: 'D', brandClass: 'brand-deepl', name: 'DeepL' },
  deeplx: { brand: 'X', brandClass: 'brand-deeplx', name: 'DeepLX' },
}

const mainEngine = computed(() => (settings.failoverOrder && settings.failoverOrder[0]) || 'ai')

const selectedEngine = ref((settings.failoverOrder && settings.failoverOrder[0]) || 'ai')

const selectEngine = (engine) => {
  selectedEngine.value = engine
  testResult.value = null
}

// 引擎配置测试：用固定文本真实调用选中引擎，验证配置是否可用
const TEST_TEXT = 'Hello World'
const testingEngine = ref('')
const testResult = ref(null)

const runEngineTest = async (engine) => {
  if (testingEngine.value) return
  testingEngine.value = engine
  testResult.value = null
  try {
    let result = ''
    switch (engine) {
      case 'ai': {
        if (!window.utools || !window.utools.ai) throw new Error('uTools AI 不可用，请在 uTools 中配置 AI 服务')
        const r = await window.utools.ai({
          messages: [{ role: 'user', content: 'Translate the following text to Simplified Chinese and reply with the translation only:\n' + TEST_TEXT }]
        })
        result = (r && r.content && r.content.trim()) || ''
        break
      }
      case 'thirdparty-ai': {
        if (!settings.thirdpartyAiUrl || !settings.thirdpartyAiUrl.trim()) throw new Error('请先填写 API 链接')
        if (!settings.thirdpartyAiModel || !settings.thirdpartyAiModel.trim()) throw new Error('请先填写模型名')
        const data = await window.services.requestThirdpartyAI(
          settings.thirdpartyAiUrl,
          settings.thirdpartyAiKey,
          { model: settings.thirdpartyAiModel, messages: [{ role: 'user', content: 'Translate the following text to Simplified Chinese and reply with the translation only:\n' + TEST_TEXT }], stream: false }
        )
        if (data && data.error) throw new Error((typeof data.error === 'object' && data.error.message) || JSON.stringify(data.error))
        result = (data?.choices?.[0]?.message?.content || '').trim()
        break
      }
      case 'google':
        result = await window.services.googleTranslate(TEST_TEXT, 'en', 'zh-CN')
        break
      case 'deepl':
        if (!settings.deeplApiKey || !settings.deeplApiKey.trim()) throw new Error('请先填写 DeepL API Key')
        result = await window.services.deeplTranslate(TEST_TEXT, 'en', 'zh-CN', settings.deeplApiKey)
        break
      case 'deeplx':
        if (!settings.deeplxServerUrl || !settings.deeplxServerUrl.trim()) throw new Error('请先填写 DeepLX 服务器地址')
        result = await window.services.deeplxTranslate(TEST_TEXT, 'en', 'zh-CN', settings.deeplxServerUrl, settings.deeplxToken)
        break
      default:
        throw new Error('未知引擎')
    }
    if (!result) throw new Error('引擎返回空结果')
    testResult.value = { engine, ok: true, message: `连接正常：${result}` }
  } catch (err) {
    testResult.value = { engine, ok: false, message: err.message || '测试失败' }
  } finally {
    testingEngine.value = ''
  }
}

const dragIndex = ref(null)
const dragOverIndex = ref(null)
// 拖拽落点相对目标卡片的位置：'before' 插入到目标之前、'after' 插入到目标之后
const dragOverPos = ref(null)

const onDragStart = (index) => { dragIndex.value = index }
const onDragOver = (index, event) => {
  if (dragIndex.value === null || dragIndex.value === index) return
  // 依据光标在目标卡片的上/下半区决定插入方向，下半区即可将元素放到末尾
  const rect = event.currentTarget.getBoundingClientRect()
  const isAfter = (event.clientY - rect.top) > rect.height / 2
  dragOverIndex.value = index
  dragOverPos.value = isAfter ? 'after' : 'before'
}
const onDrop = (index) => {
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = null
    dragOverIndex.value = null
    dragOverPos.value = null
    return
  }
  const newOrder = [...settings.failoverOrder]
  const [moved] = newOrder.splice(dragIndex.value, 1)
  // 计算实际插入索引：'after' 表示插入到目标之后
  let insertIndex = dragOverPos.value === 'after' ? index + 1 : index
  // 从前往后拖时，移除原元素会让后续索引整体前移 1，需要补偿
  if (dragIndex.value < insertIndex) insertIndex -= 1
  newOrder.splice(insertIndex, 0, moved)
  updateSetting('failoverOrder', newOrder)
  dragIndex.value = null
  dragOverIndex.value = null
  dragOverPos.value = null
}
const onDragEnd = () => {
  dragIndex.value = null
  dragOverIndex.value = null
  dragOverPos.value = null
}

const openDeeplSignup = () => {
  window.utools.shellOpenExternal('https://www.deepl.com/pro-api')
}

const openDeeplxGuide = () => {
  window.utools.shellOpenExternal('https://github.com/OwO-Network/DeepLX')
}

// 第三方 AI 模型列表远程获取
const fetchingModels = ref(false)
const modelList = ref([])
const modelListError = ref('')

const handleFetchModels = async () => {
  if (fetchingModels.value) return
  if (!settings.thirdpartyAiUrl || !settings.thirdpartyAiUrl.trim()) {
    modelListError.value = '请先填写 API 链接'
    modelList.value = []
    return
  }
  if (!settings.thirdpartyAiKey || !settings.thirdpartyAiKey.trim()) {
    modelListError.value = '请先填写 API Key'
    modelList.value = []
    return
  }
  if (!window.services || !window.services.fetchThirdpartyModels) {
    modelListError.value = '服务不可用'
    return
  }
  fetchingModels.value = true
  modelListError.value = ''
  modelList.value = []
  try {
    const models = await window.services.fetchThirdpartyModels(
      settings.thirdpartyAiUrl,
      settings.thirdpartyAiKey
    )
    modelList.value = models
  } catch (err) {
    modelListError.value = err.message || '获取模型失败'
  } finally {
    fetchingModels.value = false
  }
}

const selectModel = (model) => {
  updateSetting('thirdpartyAiModel', model)
}

// 自定义 AI API Key 显示/隐藏切换
const showThirdpartyAiKey = ref(false)
// DeepL API Key 显示/隐藏切换
const showDeeplApiKey = ref(false)
// DeepLX 访问令牌显示/隐藏切换
const showDeeplxToken = ref(false)
// DeepLX 复制成功反馈（短时高亮）
const copiedDeeplxUrl = ref(false)

// 从可能内嵌令牌的 DeepLX 地址中抽取令牌 + 清理出 base 地址
// 识别两种带令牌的写法：
//   1. https://host/TOKEN/translate → 抽出 TOKEN，地址变为 https://host
//   2. https://host/TOKEN            → 抽出 TOKEN，地址变为 https://host
// 纯 base（无路径）、base/translate（无令牌段）不抽取，返回 null。
const extractDeeplxToken = (value) => {
  const trimmed = (value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!path) return null
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) return null
    if (segments[segments.length - 1] === 'translate' && segments.length > 1) {
      // .../TOKEN/translate → 令牌在 translate 前一段
      return { serverUrl: `${url.protocol}//${url.host}`, token: segments[segments.length - 2] }
    } else if (segments.length === 1 && segments[0] !== 'translate') {
      // .../TOKEN（单段非 translate）→ 视为令牌
      return { serverUrl: `${url.protocol}//${url.host}`, token: segments[0] }
    }
    return null
  } catch (e) {
    return null
  }
}

// 回填复制按钮所需的完整 URL（base + 令牌 + /translate）
const buildDeeplxFullUrl = () => {
  const base = (settings.deeplxServerUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  const token = (settings.deeplxToken || '').trim()
  return token ? `${base}/${token}/translate` : `${base}/translate`
}

// 复制完整地址（含令牌）到剪贴板
const copyDeeplxFullUrl = async () => {
  const url = buildDeeplxFullUrl()
  if (!url) return
  try {
    await copyText(url)
    copiedDeeplxUrl.value = true
    setTimeout(() => { copiedDeeplxUrl.value = false }, 1500)
  } catch (e) {
    // copyText 内部已提示
  }
}

// DeepLX 服务器地址输入：自动从 URL 中抽取令牌到访问令牌字段
const handleDeeplxUrlInput = (value) => {
  updateSetting('deeplxServerUrl', value)
  const extracted = extractDeeplxToken(value)
  if (extracted) {
    updateSetting('deeplxToken', extracted.token)
    updateSetting('deeplxServerUrl', extracted.serverUrl)
  }
}

// 打开设置页时一次性转换：已配置的带令牌地址自动拆分到访问令牌字段
// 保证旧数据（地址内嵌令牌）与新交互一致——地址只保留 base，令牌进入独立字段
{
  const extracted = extractDeeplxToken(settings.deeplxServerUrl)
  if (extracted) {
    updateSetting('deeplxToken', extracted.token)
    updateSetting('deeplxServerUrl', extracted.serverUrl)
  }
}

const aiOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: 'AI 生成美式 IPA 音标' },
  { key: 'showDefinitions', label: '显示释义', desc: 'AI 生成 3-5 条英文释义' },
  { key: 'showExamples', label: '显示例句', desc: 'AI 生成 3-5 条英文例句' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
  { key: 'showContextNote', label: '显示语境说明', desc: 'AI 补充单词使用场景说明' },
]

const googleOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: '词典查询获取音标' },
  { key: 'showDefinitions', label: '显示释义', desc: '词典查询获取释义' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
]

const deeplOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: '词典查询获取音标' },
  { key: 'showDefinitions', label: '显示释义', desc: '词典查询获取释义' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
]

// -- 日志管理 --
const engineName = (e) => ({ ai:'uTools AI', 'thirdparty-ai':'自定义 AI', google:'Google 翻译', deepl:'DeepL 官方', deeplx:'DeepLX 自部署', system:'系统' })[e] || e

const logs = ref([])
const logCount = ref(0)
const copyBtnText = ref('复制日志')

const refreshLogs = () => {
  logs.value = getLogs()
  logCount.value = getLogCount()
}

const handleLogLevelSelect = (v) => updateSetting('logLevel', v)
const handleRetentionSelect = (v) => updateSetting('logRetentionDays', v)

const handleClearLogs = () => { clearLogs(); refreshLogs() }

const handleCopyLogs = async () => {
  try {
    await copyText(formatLogsText())
    copyBtnText.value = '已复制'
    setTimeout(() => { copyBtnText.value = '复制日志' }, 1500)
  } catch (e) {}
}

const formatTime = (ts) => new Date(ts).toLocaleString('zh-CN', { hour12: false })

// -- 稳定性统计 --
const engineStats = ref({})

const refreshEngineStats = () => {
  engineStats.value = getEngineStats()
}

const stabilityList = computed(() => {
  return (settings.failoverOrder || [])
    .filter(id => engineMeta[id])
    .map(id => ({
      id,
      meta: engineMeta[id],
      metrics: computeStability(engineStats.value[id] || null),
    }))
})

const hasAnyStats = computed(() =>
  stabilityList.value.some(item => item.metrics.hasData)
)

const pct = (r) => (r == null ? '--' : Math.round(r * 100) + '%')

const stabilityRateClass = (metrics) => {
  if (!metrics.hasData) return ''
  return metrics.rate >= 0.9 ? 'rate-green' : metrics.rate >= 0.7 ? 'rate-amber' : 'rate-red'
}

const stabilityBarClass = (metrics) => {
  if (!metrics.hasData) return ''
  return metrics.rate >= 0.9 ? 'bar-green' : metrics.rate >= 0.7 ? 'bar-amber' : 'bar-red'
}

const sortedByStability = computed(() => {
  const order = settings.failoverOrder || []
  const stats = engineStats.value
  const entries = order.map(id => ({ id, metrics: computeStability(stats[id] || null) }))
  const withData = entries.filter(e => e.metrics.hasData)
  const withoutData = entries.filter(e => !e.metrics.hasData)
  withData.sort((a, b) => {
    const rA = a.metrics.rate ?? -1
    const rB = b.metrics.rate ?? -1
    return rB - rA
  })
  return [...withData.map(e => e.id), ...withoutData.map(e => e.id)]
})

const stabilityToast = ref('')

const applyStabilityOrder = () => {
  updateSetting('failoverOrder', sortedByStability.value)
  stabilityToast.value = '已按稳定性排序'
  setTimeout(() => { stabilityToast.value = '' }, 1500)
}

const handleClearStats = () => {
  clearEngineStats()
  refreshEngineStats()
}

onMounted(() => { refreshLogs(); refreshEngineStats() })

const advancedOpen = ref(false)
const toggleAdvanced = () => { advancedOpen.value = !advancedOpen.value; refreshEngineStats() }

const recentErrorId = ref(null)
const hasErrorLog = computed(() => logs.value.some(l => l.level === 'error'))

const handleRecentError = () => {
  const entry = logs.value.find(l => l.level === 'error')
  if (!entry) return
  recentErrorId.value = entry.id
  nextTick(() => {
    const el = document.querySelector(`[data-log-id="${entry.id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
  setTimeout(() => { recentErrorId.value = null }, 3000)
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-topbar">
      <button class="back-btn" @click="handleBack">
        <span>←</span>
      </button>
      <span class="topbar-title">设置</span>
    </div>

    <div class="settings-body">
      <div class="settings-section">
        <h3 class="section-title">语言检测策略</h3>
        <div class="strategy-list">
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'regex' }"
            @click="handleStrategySelect('regex')"
          >
            <div class="strategy-info">
              <span class="strategy-name">正则算法</span>
              <span class="strategy-desc">基于字符占比快速识别，无需 AI 调用</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'regex'">✓</span>
          </div>
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'ai' }"
            @click="handleStrategySelect('ai')"
          >
            <div class="strategy-info">
              <span class="strategy-name">AI 模型</span>
              <span class="strategy-desc">调用 AI 识别，更准确（有延迟）</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'ai'">✓</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-title">翻译引擎配置</h3>
        <p class="section-hint">拖拽列表调整故障转移顺序（首位为主引擎），点击查看引擎配置。</p>
        <div class="engine-layout">
          <!-- 左列：引擎列表（拖拽调序 + 点击选中） -->
          <div class="engine-list">
            <template v-for="(engine, index) in settings.failoverOrder" :key="engine">
              <div
                v-if="engineMeta[engine]"
                class="engine-card"
                :class="{
                  active: selectedEngine === engine,
                  dragging: dragIndex === index,
                  'drag-over': dragOverIndex === index && dragIndex !== index,
                  'drag-over-before': dragOverIndex === index && dragIndex !== index && dragOverPos === 'before',
                  'drag-over-after': dragOverIndex === index && dragIndex !== index && dragOverPos === 'after'
                }"
                draggable="true"
                @dragstart="onDragStart(index)"
                @dragover.prevent="onDragOver(index, $event)"
                @drop.prevent="onDrop(index)"
                @dragend="onDragEnd"
                @click="selectEngine(engine)"
              >
                <span class="engine-drag-handle">⠿</span>
                <span v-if="engineMeta[engine].icon" class="engine-card-icon">{{ engineMeta[engine].icon }}</span>
                <span v-else class="brand-badge" :class="engineMeta[engine].brandClass">{{ engineMeta[engine].brand }}</span>
                <div class="engine-card-info">
                  <span class="engine-card-name">{{ engineMeta[engine].name }}</span>
                </div>
                <span class="engine-priority">P{{ index + 1 }}</span>
              </div>
            </template>
          </div>

          <!-- 右列：选中引擎的具体配置 + 输出设置 -->
          <div class="engine-config-area">
            <Transition name="output-fade" mode="out-in">
              <div :key="selectedEngine" class="engine-config-content">
                <!-- 选中引擎的配置 -->
                <template v-if="selectedEngine === 'deepl'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">DeepL API Key</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showDeeplApiKey ? 'text' : 'password'" :value="settings.deeplApiKey" @input="updateSetting('deeplApiKey', $event.target.value)" placeholder="粘贴你的 DeepL API Key（Free 版以 :fx 结尾）" />
                      <button type="button" class="eye-toggle" :class="{ active: showDeeplApiKey }" @click="showDeeplApiKey = !showDeeplApiKey" :title="showDeeplApiKey ? '隐藏 Key' : '显示 Key'">
                        <svg v-if="showDeeplApiKey" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <p class="deepl-config-hint">免费注册获取 API Key（Developer 订阅赠送一次性 1000 万字符免费额度，用完即止）：<a class="deepl-link" @click="openDeeplSignup">前往 DeepL 注册</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'deeplx'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">服务器地址</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" type="text" :value="settings.deeplxServerUrl" @input="handleDeeplxUrlInput($event.target.value)" placeholder="http://localhost:1188 或 https://api.deeplxxx.org（含令牌会自动抽取到下方）" />
                      <button type="button" class="eye-toggle url-copy-btn" :class="{ active: copiedDeeplxUrl }" @click="copyDeeplxFullUrl" :title="copiedDeeplxUrl ? '已复制' : '复制完整地址（含令牌）'" :aria-label="copiedDeeplxUrl ? '已复制' : '复制完整地址（含令牌）'">
                        <svg v-if="!copiedDeeplxUrl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">访问令牌（可选）</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showDeeplxToken ? 'text' : 'password'" :value="settings.deeplxToken" @input="updateSetting('deeplxToken', $event.target.value)" placeholder="填写后将自动拼接为 地址/令牌/translate，也可在上方地址中直接粘贴含令牌的 URL 自动抽取" />
                      <button type="button" class="eye-toggle" :class="{ active: showDeeplxToken }" @click="showDeeplxToken = !showDeeplxToken" :title="showDeeplxToken ? '隐藏令牌' : '显示令牌'">
                        <svg v-if="showDeeplxToken" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <p class="deepl-config-hint">地址与令牌分开填写，避免令牌明文暴露。在地址中粘贴 <code class="hint-code">https://host/TOKEN/translate</code> 会自动抽取令牌到上方。需完整链接时点地址右侧复制按钮即可获取含令牌的完整 URL。自部署 DeepLX：<a class="deepl-link" @click="openDeeplxGuide">部署指南</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'thirdparty-ai'">
                  <div class="thirdparty-ai-config" style="margin-top: 0;">
                    <label class="deepl-config-label">API 链接</label>
                    <input class="deepl-api-input" type="text" :value="settings.thirdpartyAiUrl" @input="updateSetting('thirdpartyAiUrl', $event.target.value)" placeholder="https://api.openai.com/v1（只需填到 v1）" />
                    <label class="deepl-config-label" style="margin-top: 10px;">API Key</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showThirdpartyAiKey ? 'text' : 'password'" :value="settings.thirdpartyAiKey" @input="updateSetting('thirdpartyAiKey', $event.target.value)" placeholder="sk-..." />
                      <button type="button" class="eye-toggle" :class="{ active: showThirdpartyAiKey }" @click="showThirdpartyAiKey = !showThirdpartyAiKey" :title="showThirdpartyAiKey ? '隐藏 Key' : '显示 Key'">
                        <svg v-if="showThirdpartyAiKey" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">模型</label>
                    <div class="model-input-row">
                      <input class="deepl-api-input model-input" type="text" :value="settings.thirdpartyAiModel" @input="updateSetting('thirdpartyAiModel', $event.target.value)" placeholder="gpt-4o / deepseek-chat / qwen-plus" />
                      <button class="fetch-models-btn" :disabled="fetchingModels" @click="handleFetchModels">
                        <span v-if="!fetchingModels">获取模型</span>
                        <span v-else class="fetch-models-loading">
                          <span class="loading-dot"></span>
                          <span class="loading-dot"></span>
                          <span class="loading-dot"></span>
                        </span>
                      </button>
                    </div>
                    <p v-if="modelListError" class="model-fetch-error">{{ modelListError }}</p>
                    <div v-if="modelList.length" class="model-list">
                      <button
                        v-for="m in modelList"
                        :key="m"
                        class="model-chip"
                        :class="{ active: m === settings.thirdpartyAiModel }"
                        :title="m"
                        @click="selectModel(m)"
                      >{{ m }}</button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">系统提示词（翻译时追加到默认指令）</label>
                    <textarea class="thirdparty-ai-prompt" :value="settings.thirdpartyAiSystemPrompt" @input="updateSetting('thirdpartyAiSystemPrompt', $event.target.value)" placeholder="可选。填写后作为 system role，user role 仍放默认翻译指令。留空仅用默认指令。" rows="4"></textarea>
                    <p class="deepl-config-hint">兼容 OpenAI 协议（Bearer Key 认证）。API 链接只需填到 <code class="hint-code">/v1</code>，程序自动补全 <code class="hint-code">/chat/completions</code>。支持 OpenAI/DeepSeek/通义千问/Moonshot 等。系统提示词留空时仅用默认翻译指令。</p>
                  </div>
                </template>
                <template v-else>
                  <div class="engine-no-config">
                    <span v-if="engineMeta[selectedEngine].icon" class="engine-no-config-icon">{{ engineMeta[selectedEngine].icon }}</span>
                    <span v-else class="brand-badge" :class="engineMeta[selectedEngine].brandClass">{{ engineMeta[selectedEngine].brand }}</span>
                    <span>{{ engineMeta[selectedEngine].name }} 无需额外配置</span>
                  </div>
                </template>

                <div class="engine-test-block">
                  <button
                    class="engine-test-btn"
                    :class="{ 'is-testing': testingEngine === selectedEngine }"
                    :disabled="!!testingEngine"
                    @click="runEngineTest(selectedEngine)"
                  >
                    <template v-if="testingEngine !== selectedEngine">
                      <svg class="engine-test-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12A2 2 0 0 1 14 9.53V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>
                      <span>测试配置</span>
                    </template>
                    <template v-else>
                      <span class="engine-test-spinner"></span>
                      <span>测试中…</span>
                    </template>
                  </button>
                  <Transition name="test-fade">
                    <div
                      v-if="testResult && testResult.engine === selectedEngine"
                      class="engine-test-status"
                      :class="testResult.ok ? 'test-ok' : 'test-fail'"
                    >
                      <span class="engine-test-icon">
                        <svg v-if="testResult.ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </span>
                      <span class="engine-test-msg">{{ testResult.message }}</span>
                    </div>
                  </Transition>
                </div>

                <div class="config-divider"></div>

                <!-- 输出设置：基于主引擎（failoverOrder[0]），不随选中引擎变化 -->
                <div class="outputs-list">
                  <div
                    v-for="item in (mainEngine === 'ai' || mainEngine === 'thirdparty-ai') ? aiOutputs : (mainEngine === 'deepl' || mainEngine === 'deeplx') ? deeplOutputs : googleOutputs"
                    :key="item.key"
                    class="output-item"
                  >
                    <div class="output-info">
                      <span class="output-name">{{ item.label }}</span>
                      <span class="output-desc">{{ item.desc }}</span>
                    </div>
                    <button
                      class="toggle-switch"
                      :class="{ active: settings[item.key] }"
                      @click="toggleSetting(item.key)"
                    >
                      <span class="toggle-slider"></span>
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div class="advanced-section">
        <div class="advanced-header" @click="toggleAdvanced">
          <span class="advanced-title">高级</span>
          <span class="advanced-arrow" :class="{ open: advancedOpen }">▶</span>
        </div>
        <div class="advanced-body" :class="{ open: advancedOpen }">
          <div class="advanced-body-inner">
            <h3 class="section-title">稳定性统计</h3>
            <p class="section-hint">记录每次翻译引擎调用的成功/失败，与日志等级无关，始终记录。成功率可反映各引擎当前可用性，帮助优化故障转移顺序。</p>

            <div class="stability-viewer">
              <div class="stability-viewer-header">
                <span class="stability-viewer-title">引擎成功率</span>
                <div class="stability-viewer-actions">
                  <span v-if="stabilityToast" class="stability-toast">{{ stabilityToast }}</span>
                  <button class="log-action-btn" :disabled="!hasAnyStats" @click="applyStabilityOrder" title="按近期成功率从高到低重排故障转移顺序（无记录的引擎保持原顺序置于末尾）">按稳定性排序</button>
                  <button class="log-action-btn log-clear-btn" :disabled="!hasAnyStats" @click="handleClearStats">清空统计</button>
                  <button class="log-action-btn log-refresh-btn" @click="refreshEngineStats">刷新</button>
                </div>
              </div>
              <div class="stability-list">
                <div v-if="!hasAnyStats" class="log-empty">暂无翻译记录，翻译后将自动统计各引擎成功率。</div>
                <div v-for="(item, index) in stabilityList" :key="item.id" class="stability-row">
                  <div class="stability-row-left">
                    <span v-if="item.meta.icon" class="stability-engine-icon">{{ item.meta.icon }}</span>
                    <span v-else class="brand-badge" :class="item.meta.brandClass">{{ item.meta.brand }}</span>
                    <span class="stability-engine-name">{{ item.meta.name }}</span>
                    <span class="stability-priority">P{{ index + 1 }}</span>
                  </div>
                  <div class="stability-row-right">
                    <span class="stability-rate" :class="stabilityRateClass(item.metrics)">{{ pct(item.metrics.rate) }}</span>
                    <div class="stability-bar">
                      <div v-if="item.metrics.hasData" class="stability-bar-fill" :class="stabilityBarClass(item.metrics)" :style="{ width: Math.round(item.metrics.rate * 100) + '%' }"></div>
                    </div>
                    <span class="stability-stat">共 {{ item.metrics.total }} 次</span>
                    <span class="stability-stat stability-stat-success">成功 {{ item.metrics.success }}</span>
                    <span class="stability-stat stability-stat-failure">失败 {{ item.metrics.failure }}</span>
                    <span v-if="item.metrics.hasData && item.metrics.recentSamples >= 5" class="stability-stat-recent">
                      近期 {{ pct(item.metrics.recentRate) }}
                      <span class="stability-stat-recent-count">({{ item.metrics.recentSamples }}/{{ ENGINE_STATS_RECENT_WINDOW }})</span>
                    </span>
                    <span v-else-if="item.metrics.hasData" class="stability-stat-recent">
                      总体 {{ pct(item.metrics.overallRate) }}
                      <span class="stability-stat-recent-count">({{ item.metrics.total }}次)</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <h3 class="section-title">日志管理</h3>
            <p class="section-hint">记录翻译引擎调用失败等事件，便于排查问题与提 issue。仅保留最近记录。</p>

            <div class="log-config-row">
              <div class="log-config-item">
                <label class="log-config-label">日志等级</label>
                <div class="log-level-options">
                  <button v-for="opt in LOG_LEVEL_OPTIONS" :key="opt.value"
                    class="log-level-chip" :class="{ active: settings.logLevel === opt.value }"
                    @click="handleLogLevelSelect(opt.value)">{{ opt.label }}</button>
                </div>
              </div>
              <div class="log-config-item">
                <label class="log-config-label">保留时间</label>
                <div class="log-level-options">
                  <button v-for="opt in LOG_RETENTION_OPTIONS" :key="opt.value"
                    class="log-level-chip" :class="{ active: settings.logRetentionDays === opt.value }"
                    @click="handleRetentionSelect(opt.value)">{{ opt.label }}</button>
                </div>
              </div>
            </div>

            <div class="log-viewer">
              <div class="log-viewer-header">
                <span class="log-viewer-title">最近日志 <span class="log-count-badge">{{ logCount }}</span></span>
                <div class="log-viewer-actions">
                  <button class="log-action-btn log-recent-error-btn" :disabled="!hasErrorLog" @click="handleRecentError">最近错误</button>
                  <button class="log-action-btn" :disabled="logCount === 0" @click="handleCopyLogs">{{ copyBtnText }}</button>
                  <button class="log-action-btn log-clear-btn" :disabled="logCount === 0" @click="handleClearLogs">清空日志</button>
                  <button class="log-action-btn log-refresh-btn" @click="refreshLogs">刷新</button>
                </div>
              </div>
              <div class="log-list">
                <div v-if="logs.length === 0" class="log-empty">暂无日志记录</div>
                <div v-for="entry in logs" :key="entry.id" class="log-entry" :class="['log-level-' + entry.level, { 'log-recent-highlight': recentErrorId === entry.id }]" :data-log-id="entry.id">
                  <span class="log-entry-dot" :class="'dot-' + entry.level"></span>
                  <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
                  <span class="log-level-tag">{{ levelLabel(entry.level) }}</span>
                  <span class="log-engine">{{ engineName(entry.engine) }}</span>
                  <div class="log-message">{{ entry.message }}</div>
                  <div v-if="entry.detail" class="log-detail">{{ entry.detail }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
}

.settings-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  flex-shrink: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary, #64748b);
  transition: all 0.2s;
}

.back-btn:hover {
  background: white;
  color: var(--text-primary, #1e293b);
  transform: translateX(-1px);
}

.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
}

.settings-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.strategy-list {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.strategy-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-item:hover {
  background: rgba(241, 245, 249, 1);
}

.strategy-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.strategy-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strategy-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.strategy-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.strategy-check {
  color: #6366f1;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}

/* Engine left-right layout */
.engine-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.engine-list {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.engine-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  cursor: grab;
  transition: all 0.2s;
  user-select: none;
}

.engine-card:hover {
  background: rgba(241, 245, 249, 1);
  border-color: rgba(99, 102, 241, 0.3);
}

.engine-card.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.engine-card.dragging {
  opacity: 0.5;
}

.engine-card.drag-over.drag-over-before {
  border-top: 2px solid #6366f1;
}

.engine-card.drag-over.drag-over-after {
  border-bottom: 2px solid #6366f1;
}

.engine-drag-handle {
  font-size: 16px;
  color: var(--text-secondary, #94a3b8);
  cursor: grab;
  flex-shrink: 0;
  line-height: 1;
  transition: color 0.2s;
}

.engine-card:hover .engine-drag-handle {
  color: #6366f1;
}

.engine-card-icon {
  font-size: 18px;
  flex-shrink: 0;
}

/* 品牌色圆牌字母：用于 Google/DeepL/DeepLX（emoji 无官方图标的品牌） */
.brand-badge {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: -0.5px;
  user-select: none;
}

.brand-google { background: #4285F4; }
.brand-deepl { background: #0F2B46; }
.brand-deeplx { background: #f97316; }

.engine-card-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.engine-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

/* 故障转移优先级徽章：P1=主引擎，与 P2+ 样式一致 */
.engine-priority {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text-secondary, #64748b);
  background: rgba(226, 232, 240, 0.6);
  border: 1px solid rgba(203, 213, 224, 0.8);
  padding: 2px 7px;
  border-radius: 6px;
  flex-shrink: 0;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.section-hint {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin: -8px 0 12px 0;
  line-height: 1.4;
}

.engine-config-area {
  flex: 1;
  min-width: 0;
}

.engine-config-content {
  /* wrapper for config + outputs */
}

.engine-no-config {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.engine-no-config-icon {
  font-size: 16px;
}

/* 引擎配置测试 */
.engine-test-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.engine-test-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: #6366f1;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  min-width: 92px;
  font-family: inherit;
  box-shadow: 0 1px 2px rgba(99, 102, 241, 0.2);
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
}

.engine-test-btn-icon {
  width: 13px;
  height: 13px;
  display: block;
  flex-shrink: 0;
  transition: transform 0.25s ease;
}

.engine-test-btn:hover:not(:disabled) {
  background: #4f46e5;
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(99, 102, 241, 0.3);
}

.engine-test-btn:hover:not(:disabled) .engine-test-btn-icon {
  transform: rotate(-8deg);
}

.engine-test-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
  box-shadow: 0 1px 2px rgba(99, 102, 241, 0.2);
}

.engine-test-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 当前引擎测试中：保持实色按钮以展示 spinner */
.engine-test-btn.is-testing:disabled {
  opacity: 1;
}

/* 细环 spinner，替代原三圆点 */
.engine-test-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  animation: engine-test-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes engine-test-spin {
  to { transform: rotate(360deg); }
}

.engine-test-status {
  flex: 1;
  min-width: min(200px, 100%);
  max-width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.engine-test-status.test-ok {
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.22);
}

.engine-test-status.test-fail {
  background: rgba(239, 68, 68, 0.06);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.22);
}

/* 圆形图标徽：彩色实底 + 白色符号 */
.engine-test-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.engine-test-icon svg {
  width: 9px;
  height: 9px;
  display: block;
}

.test-ok .engine-test-icon {
  background: #10b981;
  box-shadow: 0 1px 2px rgba(16, 185, 129, 0.35);
}

.test-fail .engine-test-icon {
  background: #ef4444;
  box-shadow: 0 1px 2px rgba(239, 68, 68, 0.35);
}

.engine-test-msg {
  min-width: 0;
  overflow-wrap: break-word;
  word-break: break-word;
}

/* 状态条滑入淡入 + 图标徽弹入 */
.test-fade-enter-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.test-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.test-fade-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}

.test-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.test-fade-enter-active .engine-test-icon {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.08s;
}

.test-fade-enter-from .engine-test-icon {
  transform: scale(0.3);
}

.config-divider {
  height: 1px;
  background: rgba(226, 232, 240, 0.6);
  margin: 16px 0;
}

.deepl-config {
  padding: 12px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
}

.deepl-config-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  margin-bottom: 8px;
}

.deepl-api-input {
  width: 100%;
  padding: 10px 12px;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary, #1e293b);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.deepl-api-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.deepl-api-input::placeholder {
  color: var(--text-secondary, #94a3b8);
}

/* API Key 输入框 + 眼睛切换按钮 */
.input-with-eye {
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.input-with-eye .deepl-api-input {
  padding-right: 38px;
}

.eye-toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  padding: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary, #94a3b8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  line-height: 0;
  transition: color 0.2s, background 0.2s;
}

.eye-toggle:hover {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
}

.eye-toggle.active {
  color: #6366f1;
}

.eye-toggle svg {
  width: 18px;
  height: 18px;
  display: block;
}

/* DeepLX 地址复制按钮：复用 eye-toggle 布局，复制成功时绿色高亮 */
.url-copy-btn.active {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.url-copy-btn.active:hover {
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
}

.thirdparty-ai-prompt {
  width: 100%;
  padding: 10px 12px;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #1e293b);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
}

.thirdparty-ai-prompt:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.thirdparty-ai-prompt::placeholder {
  color: var(--text-secondary, #94a3b8);
}

/* 模型输入框 + 获取按钮组合 */
.model-input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.model-input {
  flex: 1;
  min-width: 0;
}

.fetch-models-btn {
  flex-shrink: 0;
  padding: 0 14px;
  background: #6366f1;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  font-family: inherit;
}

.fetch-models-btn:hover:not(:disabled) {
  background: #4f46e5;
}

.fetch-models-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.fetch-models-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* 加载中三个跳动点 */
.fetch-models-loading {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.fetch-models-loading .loading-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ffffff;
  animation: fetch-loading-bounce 1.2s infinite ease-in-out;
}

.fetch-models-loading .loading-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.fetch-models-loading .loading-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes fetch-loading-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.model-fetch-error {
  margin-top: 6px;
  font-size: 12px;
  color: #ef4444;
  line-height: 1.4;
}

.model-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 8px;
}

.model-chip {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(203, 213, 224, 0.8);
  border-radius: 6px;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chip:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.4);
}

.model-chip.active {
  background: #6366f1;
  color: #ffffff;
  border-color: #6366f1;
}

.model-list::-webkit-scrollbar {
  width: 6px;
}

.model-list::-webkit-scrollbar-track {
  background: transparent;
}

.model-list::-webkit-scrollbar-thumb {
  background: rgba(99, 102, 241, 0.3);
  border-radius: 3px;
}

.deepl-config-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.4;
}

.deepl-link {
  color: #6366f1;
  cursor: pointer;
  text-decoration: underline;
}

.deepl-link:hover {
  color: #4f46e5;
}

.hint-code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  padding: 1px 5px;
  border-radius: 4px;
}

.outputs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border-radius: 10px;
  transition: background 0.2s;
}

.output-item:hover {
  background: rgba(241, 245, 249, 1);
}

.output-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.output-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.output-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.output-fade-enter-active,
.output-fade-leave-active {
  transition: opacity 0.15s ease;
}

.output-fade-enter-from,
.output-fade-leave-to {
  opacity: 0;
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 28px;
  background: rgba(203, 213, 224, 0.8);
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.3s;
  flex-shrink: 0;
}

.toggle-switch.active {
  background: #6366f1;
}

.toggle-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-slider {
  transform: translateX(20px);
}

.settings-body::-webkit-scrollbar {
  width: 6px;
}

.settings-body::-webkit-scrollbar-track {
  background: transparent;
}

.settings-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

/* ===== 稳定性统计 ===== */
.stability-viewer {
  margin-top: 16px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  overflow: hidden;
}

.stability-viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
}

.stability-viewer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  display: flex;
  align-items: center;
  gap: 6px;
}

.stability-viewer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stability-list {
  padding: 8px;
}

.stability-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.4);
  transition: background 0.15s;
}

.stability-row:last-child {
  border-bottom: none;
}

.stability-row:hover {
  background: rgba(241, 245, 249, 0.5);
}

.stability-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.stability-engine-icon {
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1;
}

.stability-engine-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  white-space: nowrap;
}

.stability-priority {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary, #64748b);
  background: rgba(226, 232, 240, 0.6);
  border: 1px solid rgba(203, 213, 224, 0.8);
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.stability-row-right {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stability-rate {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
  flex-shrink: 0;
  line-height: 1.2;
}

.stability-rate.rate-green { color: #10b981; }
.stability-rate.rate-amber { color: #f59e0b; }
.stability-rate.rate-red { color: #ef4444; }

.stability-bar {
  flex: 1;
  min-width: 80px;
  height: 6px;
  background: rgba(226, 232, 240, 0.6);
  border-radius: 3px;
  overflow: hidden;
}

.stability-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.stability-bar-fill.bar-green { background: #10b981; }
.stability-bar-fill.bar-amber { background: #f59e0b; }
.stability-bar-fill.bar-red { background: #ef4444; }

.stability-stat {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stability-stat-success { color: #10b981; }
.stability-stat-failure { color: #ef4444; }

.stability-stat-recent {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stability-stat-recent-count {
  color: var(--text-secondary, #94a3b8);
  font-size: 10px;
}

.stability-toast {
  font-size: 12px;
  color: #10b981;
  font-weight: 500;
  animation: stability-toast-in 0.2s ease-out;
  white-space: nowrap;
}

@keyframes stability-toast-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-color-scheme: dark) {
  .settings-page {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .settings-topbar {
    background: rgba(30, 41, 59, 0.8);
    border-bottom: 1px solid rgba(51, 65, 85, 0.6);
  }

  .topbar-title {
    color: var(--text-primary, #f1f5f9);
  }

  .back-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
  }

  .back-btn:hover {
    background: #1e293b;
    color: var(--text-primary, #f1f5f9);
  }

  .section-title {
    color: var(--text-secondary, #94a3b8);
  }

  .strategy-item,
  .output-item {
    background: rgba(15, 23, 42, 0.6);
  }

  .strategy-item:hover,
  .output-item:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .strategy-item.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .strategy-name,
  .output-name {
    color: var(--text-primary, #f1f5f9);
  }

  .strategy-desc,
  .output-desc {
    color: var(--text-secondary, #64748b);
  }

  .engine-no-config {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
    color: var(--text-secondary, #94a3b8);
  }

  .engine-test-btn {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .engine-test-btn:hover:not(:disabled) {
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
  }

  .engine-test-status.test-ok {
    background: rgba(16, 185, 129, 0.12);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.28);
  }

  .engine-test-status.test-fail {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.28);
  }

  .config-divider {
    background: rgba(51, 65, 85, 0.6);
  }

  .toggle-switch {
    background: rgba(71, 85, 105, 0.8);
  }

  .deepl-api-input {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
  }

  .thirdparty-ai-prompt {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .thirdparty-ai-prompt:focus {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .thirdparty-ai-prompt::placeholder {
    color: var(--text-secondary, #64748b);
  }

  .hint-code {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }

  .model-list {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
  }

  .model-chip {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .model-chip:hover {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .model-chip.active {
    background: #6366f1;
    color: #ffffff;
    border-color: #6366f1;
  }

  .settings-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .engine-card {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .engine-card:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .engine-card.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .engine-priority {
    color: var(--text-secondary, #94a3b8);
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(71, 85, 105, 0.8);
  }

  .engine-card-name {
    color: var(--text-primary, #f1f5f9);
  }

  .section-hint {
    color: var(--text-secondary, #64748b);
  }
}

@media (max-width: 768px) {
  .settings-body {
    padding: 16px 12px;
  }
}

@media (max-width: 640px) {
  .strategy-desc {
    display: none;
  }

  .strategy-item {
    padding: 10px 12px;
  }

  .strategy-name {
    font-size: 13px;
  }

  .engine-layout {
    flex-direction: column;
  }

  .engine-list {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }

  .engine-card {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    gap: 6px;
  }

  .engine-card-info {
    flex-direction: column;
    gap: 2px;
  }

  .engine-card-name {
    font-size: 12px;
  }
}

/* ===== 日志管理 ===== */
.log-config-row {
  display: flex;
  gap: 16px;
}

.log-config-item {
  flex: 1;
  min-width: 0;
}

.log-config-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  margin-bottom: 8px;
}

.log-level-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.log-level-chip {
  padding: 8px 14px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.log-level-chip:hover {
  background: rgba(241, 245, 249, 1);
  border-color: rgba(99, 102, 241, 0.3);
}

.log-level-chip.active {
  background: #6366f1;
  color: #ffffff;
  border-color: #6366f1;
}

.log-viewer {
  margin-top: 16px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  overflow: hidden;
}

.log-viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
}

.log-viewer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-count-badge {
  font-size: 12px;
  font-weight: 600;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  padding: 1px 7px;
  border-radius: 6px;
}

.log-viewer-actions {
  display: flex;
  gap: 6px;
}

.log-action-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  background: transparent;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 6px;
  color: #6366f1;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;
}

.log-action-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.08);
}

.log-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.log-clear-btn {
  color: var(--text-secondary, #64748b);
}

.log-clear-btn:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.log-refresh-btn {
  color: var(--text-secondary, #64748b);
}

.log-refresh-btn:hover:not(:disabled) {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.log-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.log-list::-webkit-scrollbar {
  width: 6px;
}

.log-list::-webkit-scrollbar-track {
  background: transparent;
}

.log-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.log-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #94a3b8);
}

.log-entry {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.4);
  animation: log-entry-in 0.25s ease-out;
}

.log-entry:last-child {
  border-bottom: none;
}

@keyframes log-entry-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.log-entry-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 8px;
  flex-shrink: 0;
}

.dot-debug { background: #64748b; }
.dot-info { background: #3b82f6; }
.dot-warn { background: #f59e0b; }
.dot-error { background: #ef4444; }

.log-time {
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--text-secondary, #94a3b8);
}

.log-level-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
}

.log-level-debug .log-level-tag { background: rgba(100, 116, 139, 0.12); color: #64748b; }
.log-level-info .log-level-tag { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
.log-level-warn .log-level-tag { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
.log-level-error .log-level-tag { background: rgba(239, 68, 68, 0.12); color: #ef4444; }

.log-engine {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  margin-left: 6px;
}

.log-message {
  font-size: 13px;
  color: var(--text-primary, #1e293b);
  margin-top: 2px;
}

.log-detail {
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--text-secondary, #94a3b8);
  margin-top: 2px;
  word-break: break-all;
  padding-left: 8px;
  border-left: 2px solid #6366f1;
}

/* ===== 高级折叠面板 ===== */
.advanced-section {
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.8);
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.advanced-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.advanced-header:hover {
  background: rgba(241, 245, 249, 0.6);
}

.advanced-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.advanced-arrow {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  transition: transform 0.3s ease;
  line-height: 1;
}

.advanced-arrow.open {
  transform: rotate(90deg);
}

.advanced-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.35s ease;
}

.advanced-body.open {
  max-height: 2000px;
}

.advanced-body-inner {
  padding: 0 14px 14px;
  border-top: 1px solid rgba(226, 232, 240, 0.6);
}

.advanced-body-inner .section-title {
  margin-top: 12px;
}

/* ===== 最近错误按钮 ===== */
.log-recent-error-btn {
  color: #ef4444;
}

.log-recent-error-btn:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.log-recent-error-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== 日志条目高亮 ===== */
.log-recent-highlight {
  background: rgba(239, 68, 68, 0.12);
  border-radius: 6px;
  animation: log-highlight-pulse 2s ease-out;
}

@keyframes log-highlight-pulse {
  0% { background: rgba(239, 68, 68, 0.2); }
  50% { background: rgba(239, 68, 68, 0.08); }
  100% { background: rgba(239, 68, 68, 0.12); }
}

@media (prefers-color-scheme: dark) {
  .log-viewer {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .log-viewer-header {
    border-bottom-color: rgba(51, 65, 85, 0.6);
  }

  .log-action-btn {
    border-color: rgba(51, 65, 85, 0.8);
  }

  .log-level-chip {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
  }

  .log-level-chip:hover {
    background: rgba(15, 23, 42, 0.8);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .log-level-chip.active {
    background: #6366f1;
    color: #ffffff;
    border-color: #6366f1;
  }

  .log-viewer-title {
    color: var(--text-primary, #f1f5f9);
  }

  .log-entry {
    border-bottom-color: rgba(51, 65, 85, 0.4);
  }

  .log-message {
    color: var(--text-primary, #f1f5f9);
  }

  .log-detail {
    border-left-color: #818cf8;
  }

  .log-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .advanced-section {
    border-color: rgba(51, 65, 85, 0.6);
    background: rgba(15, 23, 42, 0.6);
  }

  .advanced-header:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .advanced-title {
    color: var(--text-primary, #f1f5f9);
  }

  .advanced-arrow {
    color: var(--text-secondary, #64748b);
  }

  .advanced-body-inner {
    border-top-color: rgba(51, 65, 85, 0.6);
  }

  .stability-viewer {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .stability-viewer-header {
    border-bottom-color: rgba(51, 65, 85, 0.6);
  }

  .stability-viewer-title {
    color: var(--text-primary, #f1f5f9);
  }

  .stability-row {
    border-bottom-color: rgba(51, 65, 85, 0.4);
  }

  .stability-row:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .stability-priority {
    color: var(--text-secondary, #94a3b8);
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(71, 85, 105, 0.8);
  }

  .stability-engine-name {
    color: var(--text-primary, #f1f5f9);
  }

  .stability-bar {
    background: rgba(51, 65, 85, 0.6);
  }
}

@media (max-width: 640px) {
  .log-config-row {
    flex-direction: column;
  }

  .advanced-header {
    padding: 10px 12px;
  }

  .advanced-body-inner {
    padding: 0 12px 12px;
  }

  .stability-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .stability-row-right {
    flex-wrap: wrap;
  }

  .stability-rate {
    font-size: 16px;
    min-width: 36px;
  }

  .stability-bar {
    min-width: 60px;
  }
}
</style>
