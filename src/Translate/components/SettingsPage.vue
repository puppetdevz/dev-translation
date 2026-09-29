<script setup>
import { computed, ref, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '../utils/useSettings.js'
import { copyText } from '../utils/clipboard.js'
import { getLogs, clearLogs, getLogCount, formatLogsText } from '../utils/logger.js'
import { LOG_LEVEL_OPTIONS, LOG_RETENTION_OPTIONS, levelLabel } from '../utils/logConstants.js'
import { getEngineStats, clearEngineStats, computeStability, ENGINE_STATS_RECENT_WINDOW } from '../utils/engineStats.js'
import { inspectEngine, classifyError, skipUserMessage, getRuntimeEnv } from '../utils/engineBridge.js'
import {
  normalizeEngineResponseTimeoutSeconds,
  ENGINE_RESPONSE_TIMEOUT_MIN,
  ENGINE_RESPONSE_TIMEOUT_MAX,
  snapshotEngineTimeoutMs,
  snapshotThirdpartyAiTimeoutMs,
  parseGoogleProxyUrl,
  googleProxyErrorMessage,
  snapshotGoogleProxy,
} from '../utils/storage.js'
import {
  snapshotThirdpartyAiGroups,
  createEmptyGroup,
  generateUniqueGroupName,
  runThirdpartyAiGroupFailover,
  inspectThirdpartyAiGroup,
  createGroupRequest,
} from '../utils/thirdpartyAiGroups.js'
import {
  createProbeText,
  inspectProbeEngines,
  runBatchEngineProbe,
  snapshotProbeConfig,
  isProbeConfigUnchanged,
  applyProbeOrder,
  createProbeRunGuard,
  formatProbeItemText,
  PROBE_NO_SUCCESS_MESSAGE,
  PROBE_APPLY,
} from '../utils/engineProbe.js'

const router = useRouter()
const { settings, updateSetting, toggleSetting } = useSettings()

const handleBack = () => {
  router.push({ name: 'translate' })
}

const SETTINGS_CATEGORIES = [
  { id: 'general', label: '常规' },
  { id: 'engine', label: '引擎' },
  { id: 'advanced', label: '高级' },
]
const activeCategory = ref('general')

const handleStrategySelect = (strategy) => {
  updateSetting('detectionStrategy', strategy)
}

const saveNotice = ref('')
const persistSetting = (key, value) => {
  const ok = updateSetting(key, value)
  saveNotice.value = ok ? '' : '保存失败'
  return ok
}

const googleProxyError = ref('')
const commitGoogleProxyEnabled = (nextEnabled) => {
  if (nextEnabled) {
    const parsed = parseGoogleProxyUrl(settings.googleProxyUrl)
    if (!parsed.ok) {
      googleProxyError.value = googleProxyErrorMessage(parsed.reason)
      persistSetting('googleProxyEnabled', false)
      return false
    }
  }
  googleProxyError.value = ''
  return persistSetting('googleProxyEnabled', !!nextEnabled)
}
const commitGoogleProxyUrl = (raw) => {
  const parsed = parseGoogleProxyUrl(raw)
  const draft = parsed.ok ? parsed.url : String(raw || '').trim()
  if (settings.googleProxyEnabled && !parsed.ok) {
    googleProxyError.value = googleProxyErrorMessage(parsed.reason)
    persistSetting('googleProxyEnabled', false)
    return persistSetting('googleProxyUrl', draft)
  }
  googleProxyError.value = (!draft || parsed.ok) ? '' : googleProxyErrorMessage(parsed.reason)
  return persistSetting('googleProxyUrl', draft)
}

const commitEngineTimeout = (raw) => {
  const normalized = normalizeEngineResponseTimeoutSeconds(raw)
  persistSetting('engineResponseTimeoutSeconds', normalized)
}

const commitGroupTimeout = (raw) => {
  const normalized = normalizeEngineResponseTimeoutSeconds(raw)
  persistSetting('thirdpartyAiFailoverTimeoutSeconds', normalized)
}

const engineMeta = {
  ai: { icon: '⚡', name: 'uTools AI' },
  'thirdparty-ai': { icon: '🧠', name: '自定义 AI' },
  google: { brand: 'G', brandClass: 'brand-google', name: 'Google' },
  deepl: { brand: 'D', brandClass: 'brand-deepl', name: 'DeepL' },
  deeplx: { brand: 'X', brandClass: 'brand-deeplx', name: 'DeepLX' },
  baidu: { brand: '百', brandClass: 'brand-baidu', name: '百度' },
  aliyun: { brand: '阿', brandClass: 'brand-aliyun', name: '阿里' },
  caiyun: { brand: '彩', brandClass: 'brand-caiyun', name: '彩云' },
}

const officialEngineConfigured = (engine) => {
  const present = key => !!String(settings[key] || '').trim()
  if (engine === 'baidu') return present('baiduAppId') && present('baiduSecret')
  if (engine === 'aliyun') return present('aliyunAccessKeyId') && present('aliyunAccessKeySecret')
  if (engine === 'caiyun') return present('caiyunToken')
  return true
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
const testingGroupId = ref('')
const testResult = ref(null)

let engineTestGen = 0

const runEngineTest = async (engine) => {
  if (testingEngine.value || testingGroupId.value) return
  testingEngine.value = engine
  testResult.value = null
  const gen = ++engineTestGen
  const settingsSnap = {
    ...settings,
    thirdpartyAiGroups: snapshotThirdpartyAiGroups(settings),
    thirdpartyAiFailoverTimeoutSeconds: settings.thirdpartyAiFailoverTimeoutSeconds,
    thirdpartyAiSystemPrompt: settings.thirdpartyAiSystemPrompt || '',
  }
  try {
    const inspection = inspectEngine(engine, settingsSnap)
    if (inspection.status === 'skipped') {
      if (gen !== engineTestGen) return
      testResult.value = { engine, ok: false, message: skipUserMessage(inspection) }
      return
    }
    let result = ''
    let successGroupName = ''
    switch (engine) {
      case 'ai': {
        const r = await window.utools.ai({
          messages: [{ role: 'user', content: 'Translate the following text to Simplified Chinese and reply with the translation only:\n' + TEST_TEXT }]
        })
        result = (r && r.content && r.content.trim()) || ''
        break
      }
      case 'thirdparty-ai': {
        const chain = await runThirdpartyAiGroupFailover({
          groups: settingsSnap.thirdpartyAiGroups,
          timeoutMs: snapshotThirdpartyAiTimeoutMs(settingsSnap),
          requestGroup: createGroupRequest({
            includeSystemPrompt: false,
            messages: [{ role: 'user', content: 'Translate the following text to Simplified Chinese and reply with the translation only:\n' + TEST_TEXT }],
          }),
        })
        if (chain && chain.success) {
          result = (chain.result && chain.result.translation) || ''
          const hit = settingsSnap.thirdpartyAiGroups[chain.groupIndex]
          successGroupName = (hit && hit.name) || `组 ${chain.groupIndex + 1}`
          break
        }
        if (chain && chain.allSkipped) {
          throw new Error('引擎未配置必要凭据或地址')
        }
        const lastFail = [...((chain && chain.outcomes) || [])].reverse().find(o => o.status === 'failure')
        const err = new Error((lastFail && lastFail.safeMessage) || (chain && chain.message) || '自定义 AI 调用失败')
        if (lastFail && lastFail.statusCode) err.statusCode = lastFail.statusCode
        throw err
      }
      case 'google':
        result = await window.services.googleTranslate(
          TEST_TEXT,
          'en',
          'zh-CN',
          undefined,
          snapshotGoogleProxy(settingsSnap),
        )
        break
      case 'deepl':
        result = await window.services.deeplTranslate(TEST_TEXT, 'en', 'zh-CN', settings.deeplApiKey)
        break
      case 'deeplx':
        result = await window.services.deeplxTranslate(TEST_TEXT, 'en', 'zh-CN', settings.deeplxServerUrl, settings.deeplxToken)
        break
      case 'baidu':
        result = await window.services.baiduTranslate(
          TEST_TEXT,
          'en',
          'zh-CN',
          settingsSnap.baiduAppId,
          settingsSnap.baiduSecret,
          snapshotEngineTimeoutMs(settingsSnap),
        )
        break
      case 'aliyun':
        result = await window.services.aliyunTranslate(
          TEST_TEXT,
          'en',
          'zh-CN',
          settingsSnap.aliyunAccessKeyId,
          settingsSnap.aliyunAccessKeySecret,
          snapshotEngineTimeoutMs(settingsSnap),
        )
        break
      case 'caiyun':
        result = await window.services.caiyunTranslate(
          TEST_TEXT,
          'en',
          'zh-CN',
          settingsSnap.caiyunToken,
          snapshotEngineTimeoutMs(settingsSnap),
        )
        break
      default:
        throw new Error('未知引擎')
    }
    if (!result) throw new Error('引擎返回空结果')
    if (gen !== engineTestGen) return
    testResult.value = {
      engine,
      ok: true,
      message: ['baidu', 'aliyun', 'caiyun'].includes(engine)
        ? '连接正常（已取得非空译文）'
        : (successGroupName ? `连接正常（${successGroupName}）：${result}` : `连接正常：${result}`),
    }
  } catch (err) {
    if (gen !== engineTestGen) return
    const classified = classifyError(err)
    testResult.value = { engine, ok: false, message: classified.safeMessage || '测试失败' }
  } finally {
    if (gen === engineTestGen) testingEngine.value = ''
  }
}

const probeGuard = createProbeRunGuard()
const probeRunning = ref(false)
const probeResults = ref(null)
const probeDetailsOpen = ref(false)
const probeSummary = ref('')
const probeSummaryKind = ref('')
let probeRunId = 0
let probeLeftPage = false
let probeStale = false

watch(
  () => [
    JSON.stringify(settings.failoverOrder || []),
    settings.engineResponseTimeoutSeconds,
    settings.thirdpartyAiFailoverTimeoutSeconds,
    settings.deeplApiKey,
    settings.deeplxServerUrl,
    settings.deeplxToken,
    JSON.stringify((settings.thirdpartyAiGroups || []).map(g => [g.id, g.name, g.url, g.apiKey, g.model])),
    settings.thirdpartyAiSystemPrompt,
    settings.googleProxyEnabled,
    settings.googleProxyUrl,
    settings.baiduAppId,
    settings.baiduSecret,
    settings.aliyunAccessKeyId,
    settings.aliyunAccessKeySecret,
    settings.caiyunToken,
  ],
  () => {
    if (probeRunning.value) probeStale = true
  },
  { flush: 'sync' }
)

const mergeProbeItem = (item) => {
  const list = probeResults.value ? [...probeResults.value] : []
  const idx = list.findIndex(row => row.engine === item.engine)
  if (idx >= 0) list[idx] = item
  else list.push(item)
  probeResults.value = list
}

const runBatchProbe = async () => {
  if (!probeGuard.tryStart()) return
  probeRunning.value = true
  probeDetailsOpen.value = true
  probeStale = false
  const runId = ++probeRunId
  probeSummary.value = '正在测试全部引擎…'
  probeSummaryKind.value = 'running'
  const env = getRuntimeEnv()
  const config = snapshotProbeConfig(settings)
  const timeoutMs = snapshotEngineTimeoutMs(config)
  const text = createProbeText()
  probeResults.value = inspectProbeEngines(config, env, text)
  try {
    const out = await runBatchEngineProbe({
      settings: config,
      env,
      timeoutMs,
      text,
      onItem: (item) => {
        if (runId !== probeRunId) return
        mergeProbeItem(item)
      },
    })
    if (runId !== probeRunId || probeLeftPage) return
    probeResults.value = out.results
    const stale = probeStale || !isProbeConfigUnchanged(config, settings)
    probeRunning.value = false
    const decision = applyProbeOrder({
      hadSuccess: out.hadSuccess,
      stale,
      leftPage: probeLeftPage,
      nextOrder: out.nextOrder,
      persistOrder: (order) => updateSetting('failoverOrder', order),
    })
    if (!out.hadSuccess) {
      probeSummary.value = PROBE_NO_SUCCESS_MESSAGE
      probeSummaryKind.value = 'noop'
    } else if (decision.reason === PROBE_APPLY.STALE) {
      probeSummary.value = '测试完成，设置已变更，未调整顺序'
      probeSummaryKind.value = 'stale'
    } else if (decision.reason === PROBE_APPLY.SAVE_FAILED) {
      probeSummary.value = '已按本轮速度重排，但保存失败'
      probeSummaryKind.value = 'save_failed'
    } else {
      probeSummary.value = '已按本轮速度重排，最快引擎已设为主引擎'
      probeSummaryKind.value = 'success'
    }
  } catch (err) {
    if (runId !== probeRunId || probeLeftPage) return
    const classified = classifyError(err)
    probeSummary.value = classified.safeMessage || '测试失败'
    probeSummaryKind.value = 'save_failed'
  } finally {
    probeGuard.end()
    if (runId === probeRunId) {
      probeRunning.value = false
      if (!probeLeftPage) probeDetailsOpen.value = false
    }
  }
}

onUnmounted(() => {
  probeLeftPage = true
  probeRunId += 1
})

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

const openBaiduSignup = () => {
  window.utools.shellOpenExternal('https://fanyi-api.baidu.com/product/113')
}

const openAliyunSignup = () => {
  window.utools.shellOpenExternal('https://www.aliyun.com/product/alimt')
}

const openCaiyunSignup = () => {
  window.utools.shellOpenExternal('https://platform.caiyunapp.com/regist')
}

const thirdpartyGroups = computed(() => Array.isArray(settings.thirdpartyAiGroups) ? settings.thirdpartyAiGroups : [])

const persistGroups = (groups) => persistSetting('thirdpartyAiGroups', groups)

const groupUi = reactive({})
const ensureGroupUi = (id) => {
  if (!groupUi[id]) {
    groupUi[id] = {
      showKey: false,
      fetching: false,
      models: [],
      error: '',
      fetchGen: 0,
      testGen: 0,
      testResult: null,
      pendingDelete: false,
      nameError: '',
    }
  }
  return groupUi[id]
}

watch(thirdpartyGroups, (groups) => {
  const ids = new Set((groups || []).map(g => g.id))
  for (const g of groups || []) ensureGroupUi(g.id)
  for (const id of Object.keys(groupUi)) {
    if (!ids.has(id)) delete groupUi[id]
  }
}, { immediate: true })

const bumpGroupAsync = (id) => {
  const ui = ensureGroupUi(id)
  ui.fetchGen += 1
  ui.testGen += 1
  ui.models = []
  ui.error = ''
  ui.testResult = null
}

const patchGroup = (id, patch) => {
  const groups = snapshotThirdpartyAiGroups(settings)
  const idx = groups.findIndex(g => g.id === id)
  if (idx < 0) return false
  const next = groups.map((g, i) => i === idx ? { ...g, ...patch } : g)
  if ('url' in patch || 'apiKey' in patch || 'model' in patch) bumpGroupAsync(id)
  return persistGroups(next)
}

const addAiGroup = () => {
  const groups = snapshotThirdpartyAiGroups(settings)
  const created = createEmptyGroup(groups.map(g => g.name), groups.map(g => g.id))
  persistGroups([...groups, created])
  ensureGroupUi(created.id)
}

const requestDeleteGroup = (id) => {
  ensureGroupUi(id).pendingDelete = true
}

const cancelDeleteGroup = (id) => {
  if (groupUi[id]) groupUi[id].pendingDelete = false
}

const confirmDeleteGroup = (id) => {
  const groups = snapshotThirdpartyAiGroups(settings).filter(g => g.id !== id)
  persistGroups(groups)
  delete groupUi[id]
}

const commitGroupName = (id, raw) => {
  const ui = ensureGroupUi(id)
  const groups = snapshotThirdpartyAiGroups(settings)
  const idx = groups.findIndex(g => g.id === id)
  if (idx < 0) return
  let name = String(raw || '').trim()
  const others = groups.filter((_, i) => i !== idx)
  if (!name) name = generateUniqueGroupName(others.map(g => g.name))
  if (others.some(g => g.name === name)) {
    ui.nameError = '名称已存在，未保存'
    return
  }
  ui.nameError = ''
  if (groups[idx].name === name) return
  persistGroups(groups.map((g, i) => i === idx ? { ...g, name } : g))
}

const groupDragIndex = ref(null)
const groupDragOverIndex = ref(null)
const groupDragOverPos = ref(null)

const onGroupDragStart = (index) => { groupDragIndex.value = index }
const onGroupDragOver = (index, event) => {
  if (groupDragIndex.value === null || groupDragIndex.value === index) return
  const rect = event.currentTarget.getBoundingClientRect()
  const isAfter = (event.clientY - rect.top) > rect.height / 2
  groupDragOverIndex.value = index
  groupDragOverPos.value = isAfter ? 'after' : 'before'
}
const onGroupDrop = (index) => {
  if (groupDragIndex.value === null || groupDragIndex.value === index) {
    groupDragIndex.value = null
    groupDragOverIndex.value = null
    groupDragOverPos.value = null
    return
  }
  const newOrder = snapshotThirdpartyAiGroups(settings)
  const [moved] = newOrder.splice(groupDragIndex.value, 1)
  let insertIndex = groupDragOverPos.value === 'after' ? index + 1 : index
  if (groupDragIndex.value < insertIndex) insertIndex -= 1
  newOrder.splice(insertIndex, 0, moved)
  persistGroups(newOrder)
  groupDragIndex.value = null
  groupDragOverIndex.value = null
  groupDragOverPos.value = null
}
const onGroupDragEnd = () => {
  groupDragIndex.value = null
  groupDragOverIndex.value = null
  groupDragOverPos.value = null
}

const handleFetchModels = async (groupId) => {
  const group = thirdpartyGroups.value.find(g => g.id === groupId)
  const ui = ensureGroupUi(groupId)
  if (!group || ui.fetching) return
  if (!group.url || !String(group.url).trim()) {
    ui.error = '请先填写 API 链接'
    ui.models = []
    return
  }
  if (!group.apiKey || !String(group.apiKey).trim()) {
    ui.error = '请先填写 API Key'
    ui.models = []
    return
  }
  if (!window.services || typeof window.services.fetchThirdpartyModels !== 'function') {
    ui.error = '翻译服务未加载。请重载插件，或确认安装的是最新版本后重新安装。'
    return
  }
  const snapUrl = group.url
  const snapKey = group.apiKey
  const gen = ++ui.fetchGen
  ui.fetching = true
  ui.error = ''
  ui.models = []
  try {
    const models = await window.services.fetchThirdpartyModels(snapUrl, snapKey)
    if (ui.fetchGen !== gen) return
    const current = thirdpartyGroups.value.find(g => g.id === groupId)
    if (!current || current.url !== snapUrl || current.apiKey !== snapKey) return
    ui.models = Array.isArray(models) ? models : []
  } catch (err) {
    if (ui.fetchGen !== gen) return
    const classified = classifyError(err)
    ui.error = classified.safeMessage || '获取模型失败'
  } finally {
    if (ui.fetchGen === gen) ui.fetching = false
  }
}

const selectModel = (groupId, model) => {
  patchGroup(groupId, { model })
}

const runGroupTest = async (groupId) => {
  if (testingEngine.value || testingGroupId.value) return
  const group = thirdpartyGroups.value.find(g => g.id === groupId)
  if (!group) return
  const ui = ensureGroupUi(groupId)
  const snap = { ...group }
  const gen = ++ui.testGen
  testingGroupId.value = groupId
  ui.testResult = null
  try {
    const inspection = inspectThirdpartyAiGroup(snap)
    if (inspection.status === 'skipped') {
      if (ui.testGen !== gen) return
      ui.testResult = { ok: false, message: skipUserMessage(inspection) }
      return
    }
    const requestGroup = createGroupRequest({
      includeSystemPrompt: false,
      messages: [{ role: 'user', content: 'Translate the following text to Simplified Chinese and reply with the translation only:\n' + TEST_TEXT }],
    })
    const chain = await runThirdpartyAiGroupFailover({
      groups: [snap],
      timeoutMs: snapshotThirdpartyAiTimeoutMs(settings),
      requestGroup,
    })
    if (ui.testGen !== gen) return
    const still = thirdpartyGroups.value.find(g => g.id === groupId)
    if (!still || still.url !== snap.url || still.apiKey !== snap.apiKey || still.model !== snap.model) return
    if (chain && chain.success) {
      const text = (chain.result && chain.result.translation) || ''
      ui.testResult = { ok: true, message: text ? `连接正常：${text}` : '连接正常' }
      return
    }
    const lastFail = [...((chain && chain.outcomes) || [])].reverse().find(o => o.status === 'failure' || o.status === 'skipped')
    ui.testResult = { ok: false, message: (lastFail && lastFail.safeMessage) || skipUserMessage(lastFail) || '测试失败' }
  } catch (err) {
    if (ui.testGen !== gen) return
    const classified = classifyError(err)
    ui.testResult = { ok: false, message: classified.safeMessage || '测试失败' }
  } finally {
    if (testingGroupId.value === groupId) testingGroupId.value = ''
  }
}
// DeepL API Key 显示/隐藏切换
const showDeeplApiKey = ref(false)
// DeepLX 访问令牌显示/隐藏切换
const showDeeplxToken = ref(false)
const showBaiduAppId = ref(false)
const showBaiduSecret = ref(false)
const showAliyunId = ref(false)
const showAliyunSecret = ref(false)
const showCaiyunToken = ref(false)
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

const currentOutputs = computed(() => {
  if (mainEngine.value === 'ai' || mainEngine.value === 'thirdparty-ai') return aiOutputs
  if (mainEngine.value === 'deepl' || mainEngine.value === 'deeplx') return deeplOutputs
  return googleOutputs
})

// -- 日志管理 --
const engineName = (e) => ({ ai:'uTools AI', 'thirdparty-ai':'自定义 AI', google:'Google 翻译', deepl:'DeepL 官方', deeplx:'DeepLX 自部署', baidu:'百度翻译', aliyun:'阿里翻译', caiyun:'彩云小译', system:'系统' })[e] || e

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
  stabilityList.value.some(item => item.metrics.hasData || item.metrics.skipped > 0)
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

const selectCategory = (id) => {
  if (activeCategory.value === id) return
  activeCategory.value = id
  if (id === 'advanced') {
    refreshEngineStats()
    refreshLogs()
  }
}

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
      <button class="back-btn" type="button" aria-label="返回翻译页" @click="handleBack">
        <span>←</span>
      </button>
      <span class="topbar-title">设置</span>
    </div>

    <div class="settings-shell">
      <nav class="settings-nav" role="tablist" aria-label="设置分类">
        <button
          v-for="cat in SETTINGS_CATEGORIES"
          :id="'settings-tab-' + cat.id"
          :key="cat.id"
          type="button"
          class="settings-nav-item"
          :class="{ active: activeCategory === cat.id }"
          role="tab"
          :aria-selected="activeCategory === cat.id ? 'true' : 'false'"
          :aria-controls="'settings-panel-' + cat.id"
          @click="selectCategory(cat.id)"
        >{{ cat.label }}</button>
      </nav>

      <div class="settings-content">
        <div
          id="settings-panel-general"
          class="settings-panel"
          :class="{ 'is-active': activeCategory === 'general' }"
          role="tabpanel"
          aria-labelledby="settings-tab-general"
          :aria-hidden="activeCategory === 'general' ? 'false' : 'true'"
        >
          <div class="settings-section">
            <h3 class="section-title">语言检测策略</h3>
            <div class="strategy-list">
              <button
                type="button"
                class="strategy-item"
                :class="{ active: settings.detectionStrategy === 'regex' }"
                @click="handleStrategySelect('regex')"
              >
                <div class="strategy-info">
                  <span class="strategy-name">正则算法</span>
                  <span class="strategy-desc">基于字符占比快速识别，无需 AI 调用</span>
                </div>
                <span class="strategy-check" v-if="settings.detectionStrategy === 'regex'">✓</span>
              </button>
              <button
                type="button"
                class="strategy-item"
                :class="{ active: settings.detectionStrategy === 'ai' }"
                @click="handleStrategySelect('ai')"
              >
                <div class="strategy-info">
                  <span class="strategy-name">AI 模型</span>
                  <span class="strategy-desc">调用 AI 识别，更准确（有延迟）</span>
                </div>
                <span class="strategy-check" v-if="settings.detectionStrategy === 'ai'">✓</span>
              </button>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="section-title">输出设置</h3>
            <p class="section-hint">选项由当前主引擎决定（故障转移顺序的首位），与引擎页选中的配置卡无关。</p>
            <div class="outputs-list">
              <div
                v-for="item in currentOutputs"
                :key="item.key"
                class="output-item"
              >
                <div class="output-info">
                  <span class="output-name">{{ item.label }}</span>
                  <span class="output-desc">{{ item.desc }}</span>
                </div>
                <button
                  type="button"
                  class="toggle-switch"
                  :class="{ active: settings[item.key] }"
                  :aria-pressed="settings[item.key] ? 'true' : 'false'"
                  :aria-label="item.label"
                  @click="toggleSetting(item.key)"
                >
                  <span class="toggle-slider"></span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          id="settings-panel-engine"
          class="settings-panel"
          :class="{ 'is-active': activeCategory === 'engine' }"
          role="tabpanel"
          aria-labelledby="settings-tab-engine"
          :aria-hidden="activeCategory === 'engine' ? 'false' : 'true'"
        >
      <div class="settings-section">
        <h3 class="section-title">翻译引擎配置</h3>
        <p class="section-hint">拖拽列表调整故障转移顺序（首位为主引擎），点击查看引擎配置。</p>
        <p v-if="saveNotice" class="save-failed-notice">{{ saveNotice }}</p>
        <div class="timeout-row">
          <div class="timeout-row-info">
            <span class="timeout-row-label">翻译引擎响应超时（秒）</span>
            <span class="timeout-row-desc">每个已调用引擎在此时限内未取得主译文则视为失败并尝试下一个。自定义 AI 各组使用独立的组超时，不受此时限截断。默认 5 秒，范围 {{ ENGINE_RESPONSE_TIMEOUT_MIN }}–{{ ENGINE_RESPONSE_TIMEOUT_MAX }}。</span>
          </div>
          <input
            class="timeout-input"
            type="number"
            :min="ENGINE_RESPONSE_TIMEOUT_MIN"
            :max="ENGINE_RESPONSE_TIMEOUT_MAX"
            step="1"
            :value="settings.engineResponseTimeoutSeconds"
            @change="commitEngineTimeout($event.target.value)"
            @blur="commitEngineTimeout($event.target.value)"
            aria-label="翻译引擎响应超时（秒）"
          />
        </div>
        <div class="probe-bar">
          <div class="probe-bar-row">
            <button
              class="probe-btn"
              :class="{ 'is-testing': probeRunning }"
              :disabled="probeRunning"
              title="并行测试全部引擎，成功则按本轮耗时自动重排"
              @click="runBatchProbe"
            >
              <template v-if="!probeRunning">
                <svg class="probe-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/></svg>
                <span>一键测试并排序</span>
              </template>
              <template v-else>
                <span class="engine-test-spinner"></span>
                <span>测试中…</span>
              </template>
            </button>
            <span class="probe-bar-hint">真实请求可能消耗额度；至少一个成功时按本轮速度自动重排并保存。</span>
          </div>
          <p v-if="probeSummary" class="probe-summary" :class="'probe-summary-' + probeSummaryKind">{{ probeSummary }}</p>
          <template v-if="probeResults">
            <button
              class="probe-details-toggle"
              type="button"
              aria-controls="probe-result-list"
              :aria-expanded="probeDetailsOpen"
              @click="probeDetailsOpen = !probeDetailsOpen"
            >
              <span>{{ probeDetailsOpen ? '收起测试明细' : '查看测试明细' }}（{{ probeResults.length }}）</span>
              <svg class="probe-details-icon" :class="{ 'is-open': probeDetailsOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div v-show="probeDetailsOpen" id="probe-result-list" class="probe-result-list">
              <div
                v-for="item in probeResults"
                :key="item.engine"
                class="probe-result-row"
                :class="'probe-' + (item.status || 'pending')"
              >
                <span class="probe-result-name">{{ engineMeta[item.engine] ? engineMeta[item.engine].name : item.engine }}</span>
                <span class="probe-result-text">{{ formatProbeItemText(item) }}</span>
              </div>
            </div>
          </template>
        </div>
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
                  <span v-if="!officialEngineConfigured(engine)" class="engine-card-unconfigured">未配置</span>
                </div>
                <span class="engine-priority">P{{ index + 1 }}</span>
              </div>
            </template>
          </div>

          <!-- 右列：选中引擎的具体配置（与分类侧栏独立） -->
          <div class="engine-config-area">
            <Transition name="output-fade" mode="out-in">
              <div :key="selectedEngine" class="engine-config-content">
                <div class="engine-config-header">
                  <div class="engine-config-heading">
                    <span v-if="engineMeta[selectedEngine].icon" class="engine-config-icon">{{ engineMeta[selectedEngine].icon }}</span>
                    <span v-else class="brand-badge" :class="engineMeta[selectedEngine].brandClass">{{ engineMeta[selectedEngine].brand }}</span>
                    <div class="engine-config-heading-text">
                      <span class="engine-config-name">{{ engineMeta[selectedEngine].name }}</span>
                      <span v-if="selectedEngine === 'ai'" class="engine-config-subtitle">无需额外配置</span>
                    </div>
                  </div>
                  <button
                    class="engine-test-btn"
                    :class="{ 'is-testing': testingEngine === selectedEngine }"
                    :disabled="!!testingEngine || !!testingGroupId"
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
                </div>
                <div v-if="!officialEngineConfigured(selectedEngine)" class="engine-config-warning model-fetch-error">未配置完整凭据；该引擎会跳过，不发出翻译请求。</div>
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
                <template v-else-if="selectedEngine === 'baidu'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">APP ID</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showBaiduAppId ? 'text' : 'password'" :value="settings.baiduAppId" @input="persistSetting('baiduAppId', $event.target.value)" placeholder="百度翻译开放平台 APP ID" />
                      <button type="button" class="eye-toggle eye-toggle-text" :class="{ active: showBaiduAppId }" @click="showBaiduAppId = !showBaiduAppId" :title="showBaiduAppId ? '隐藏 APP ID' : '显示 APP ID'" :aria-label="showBaiduAppId ? '隐藏 APP ID' : '显示 APP ID'">{{ showBaiduAppId ? '隐' : '显' }}</button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">密钥</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showBaiduSecret ? 'text' : 'password'" :value="settings.baiduSecret" @input="persistSetting('baiduSecret', $event.target.value)" placeholder="百度翻译密钥" />
                      <button type="button" class="eye-toggle" :class="{ active: showBaiduSecret }" @click="showBaiduSecret = !showBaiduSecret" :title="showBaiduSecret ? '隐藏密钥' : '显示密钥'">
                        <svg v-if="showBaiduSecret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <p class="deepl-config-hint">标准版单次最多 1000 字符，超长将跳过本引擎。凭据仅保存在本机，缺项不会发请求。<a class="deepl-link" @click="openBaiduSignup">申请百度翻译 API</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'aliyun'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">AccessKey ID</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showAliyunId ? 'text' : 'password'" :value="settings.aliyunAccessKeyId" @input="persistSetting('aliyunAccessKeyId', $event.target.value)" placeholder="阿里云 AccessKey ID" />
                      <button type="button" class="eye-toggle eye-toggle-text" :class="{ active: showAliyunId }" @click="showAliyunId = !showAliyunId" :title="showAliyunId ? '隐藏 ID' : '显示 ID'" :aria-label="showAliyunId ? '隐藏 ID' : '显示 ID'">{{ showAliyunId ? '隐' : '显' }}</button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">AccessKey Secret</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showAliyunSecret ? 'text' : 'password'" :value="settings.aliyunAccessKeySecret" @input="persistSetting('aliyunAccessKeySecret', $event.target.value)" placeholder="阿里云 AccessKey Secret" />
                      <button type="button" class="eye-toggle" :class="{ active: showAliyunSecret }" @click="showAliyunSecret = !showAliyunSecret" :title="showAliyunSecret ? '隐藏密钥' : '显示密钥'">
                        <svg v-if="showAliyunSecret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <p class="deepl-config-hint">需开通机器翻译并授予 <code class="hint-code">alimt:TranslateGeneral</code>。通用版单次最多 5000 字符，超长将跳过本引擎。凭据仅保存在本机。<a class="deepl-link" @click="openAliyunSignup">开通阿里云机器翻译</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'caiyun'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">API Token</label>
                    <div class="input-with-eye">
                      <input class="deepl-api-input" :type="showCaiyunToken ? 'text' : 'password'" :value="settings.caiyunToken" @input="persistSetting('caiyunToken', $event.target.value)" placeholder="彩云开放平台 API Token" />
                      <button type="button" class="eye-toggle" :class="{ active: showCaiyunToken }" @click="showCaiyunToken = !showCaiyunToken" :title="showCaiyunToken ? '隐藏 Token' : '显示 Token'">
                        <svg v-if="showCaiyunToken" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                    <p class="deepl-config-hint">须使用开放平台申请的 API Token，普通会员账号不能代替 Token。凭据仅保存在本机，缺项不会发请求。<a class="deepl-link" @click="openCaiyunSignup">申请彩云小译 Token</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'thirdparty-ai'">
                  <div class="thirdparty-ai-config" style="margin-top: 0;">
                    <p class="deepl-config-hint" style="margin-top: 0;">按组顺序逐一尝试，首组成功即停止；全部未成功才切换下一引擎。真实调用可能消耗额度并按组计时。</p>
                    <div v-if="thirdpartyGroups.length === 0" class="group-empty">暂无自定义 AI 组，该引擎将被跳过。</div>
                    <div class="ai-group-list">
                      <div
                        v-for="(group, gIndex) in thirdpartyGroups"
                        :key="group.id"
                        class="ai-group-card"
                        :class="{
                          dragging: groupDragIndex === gIndex,
                          'drag-over-before': groupDragOverIndex === gIndex && groupDragIndex !== gIndex && groupDragOverPos === 'before',
                          'drag-over-after': groupDragOverIndex === gIndex && groupDragIndex !== gIndex && groupDragOverPos === 'after',
                        }"
                        draggable="true"
                        @dragstart="onGroupDragStart(gIndex)"
                        @dragover.prevent="onGroupDragOver(gIndex, $event)"
                        @drop.prevent="onGroupDrop(gIndex)"
                        @dragend="onGroupDragEnd"
                      >
                        <div class="ai-group-head">
                          <span class="engine-drag-handle" title="拖拽调整组顺序">⠿</span>
                          <span class="ai-group-priority">G{{ gIndex + 1 }}</span>
                          <input
                            class="ai-group-name"
                            type="text"
                            :value="group.name"
                            placeholder="组名称"
                            @blur="commitGroupName(group.id, $event.target.value)"
                            @keydown.enter.prevent="$event.target.blur()"
                          />
                          <button
                            type="button"
                            class="group-mini-btn"
                            :disabled="!!testingEngine || !!testingGroupId"
                            @click.stop="runGroupTest(group.id)"
                          >{{ testingGroupId === group.id ? '测试中' : '测试' }}</button>
                          <button
                            v-if="!groupUi[group.id].pendingDelete"
                            type="button"
                            class="group-mini-btn group-mini-danger"
                            @click.stop="requestDeleteGroup(group.id)"
                          >删除</button>
                          <span v-else class="group-delete-confirm">
                            <span>确认删除？</span>
                            <button type="button" class="group-mini-btn" @click.stop="cancelDeleteGroup(group.id)">取消</button>
                            <button type="button" class="group-mini-btn group-mini-danger" @click.stop="confirmDeleteGroup(group.id)">确认</button>
                          </span>
                        </div>
                        <p v-if="groupUi[group.id].nameError" class="model-fetch-error">{{ groupUi[group.id].nameError }}</p>
                        <label class="deepl-config-label">API 链接</label>
                        <input class="deepl-api-input" type="text" :value="group.url" @input="patchGroup(group.id, { url: $event.target.value })" placeholder="https://api.openai.com/v1（只需填到 v1）" />
                        <label class="deepl-config-label" style="margin-top: 8px;">API Key</label>
                        <div class="input-with-eye">
                          <input class="deepl-api-input" :type="groupUi[group.id].showKey ? 'text' : 'password'" :value="group.apiKey" @input="patchGroup(group.id, { apiKey: $event.target.value })" placeholder="sk-..." />
                          <button type="button" class="eye-toggle" :class="{ active: groupUi[group.id].showKey }" @click="groupUi[group.id].showKey = !groupUi[group.id].showKey" :title="groupUi[group.id].showKey ? '隐藏 Key' : '显示 Key'">
                            <svg v-if="groupUi[group.id].showKey" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 0 1 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                        </div>
                        <label class="deepl-config-label" style="margin-top: 8px;">模型</label>
                        <div class="model-input-row">
                          <input class="deepl-api-input model-input" type="text" :value="group.model" @input="patchGroup(group.id, { model: $event.target.value })" placeholder="gpt-4o / deepseek-chat / qwen-plus" />
                          <button class="fetch-models-btn" :disabled="groupUi[group.id].fetching" @click="handleFetchModels(group.id)">
                            <span v-if="!groupUi[group.id].fetching">获取模型</span>
                            <span v-else class="fetch-models-loading">
                              <span class="loading-dot"></span>
                              <span class="loading-dot"></span>
                              <span class="loading-dot"></span>
                            </span>
                          </button>
                        </div>
                        <p v-if="groupUi[group.id].error" class="model-fetch-error">{{ groupUi[group.id].error }}</p>
                        <div v-if="groupUi[group.id].models.length" class="model-list">
                          <button
                            v-for="m in groupUi[group.id].models"
                            :key="m"
                            class="model-chip"
                            :class="{ active: m === group.model }"
                            :title="m"
                            @click="selectModel(group.id, m)"
                          >{{ m }}</button>
                        </div>
                        <p v-if="groupUi[group.id].testResult" class="group-test-msg" :class="groupUi[group.id].testResult.ok ? 'test-ok-text' : 'test-fail-text'">{{ groupUi[group.id].testResult.message }}</p>
                      </div>
                    </div>
                    <button type="button" class="add-group-btn" @click="addAiGroup">新增组</button>
                    <div class="timeout-row" style="margin: 10px 0 0 0;">
                      <div class="timeout-row-info">
                        <span class="timeout-row-label">自定义 AI 组超时（秒）</span>
                        <span class="timeout-row-desc">每个组单独计时，超时立即尝试下一组；不受上方一级引擎超时截断。多组挂起时总耗时约 组数×该时限。默认 5 秒，范围 {{ ENGINE_RESPONSE_TIMEOUT_MIN }}–{{ ENGINE_RESPONSE_TIMEOUT_MAX }}。</span>
                      </div>
                      <input
                        class="timeout-input"
                        type="number"
                        :min="ENGINE_RESPONSE_TIMEOUT_MIN"
                        :max="ENGINE_RESPONSE_TIMEOUT_MAX"
                        step="1"
                        :value="settings.thirdpartyAiFailoverTimeoutSeconds"
                        @change="commitGroupTimeout($event.target.value)"
                        @blur="commitGroupTimeout($event.target.value)"
                        aria-label="自定义 AI 组超时（秒）"
                      />
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">通用系统提示词（适用于所有自定义 AI 组）</label>
                    <textarea class="thirdparty-ai-prompt" :value="settings.thirdpartyAiSystemPrompt" @input="persistSetting('thirdpartyAiSystemPrompt', $event.target.value)" placeholder="可选。正式翻译时作为 system 消息发给每一组；user 消息仍是默认中英互译指令。留空不追加 system。不用于 uTools AI、润色或配置测试。" rows="3"></textarea>
                    <p class="deepl-config-hint">兼容 OpenAI 协议（Bearer Key 认证）。API 链接只需填到 <code class="hint-code">/v1</code>，程序自动补全 <code class="hint-code">/chat/completions</code>。组测试与「测试配置」会真实请求，可能消耗额度，且不发送上述系统提示词、不计入成功率。</p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'google'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <div class="google-proxy-row">
                      <div class="output-info">
                        <span class="output-name">使用 HTTP(S) 代理</span>
                        <span class="output-desc">默认关闭，仅用于 Google 翻译</span>
                      </div>
                      <button
                        type="button"
                        class="toggle-switch"
                        :class="{ active: settings.googleProxyEnabled }"
                        :aria-pressed="settings.googleProxyEnabled ? 'true' : 'false'"
                        aria-label="使用 HTTP(S) 代理"
                        @click="commitGoogleProxyEnabled(!settings.googleProxyEnabled)"
                      >
                        <span class="toggle-slider"></span>
                      </button>
                    </div>
                    <label class="deepl-config-label">代理地址</label>
                    <input
                      class="deepl-api-input"
                      type="text"
                      :value="settings.googleProxyUrl"
                      @change="commitGoogleProxyUrl($event.target.value)"
                      @blur="commitGoogleProxyUrl($event.target.value)"
                      placeholder="http://127.0.0.1:7890"
                      aria-label="Google 代理地址"
                    />
                    <p v-if="googleProxyError" class="google-proxy-error">{{ googleProxyError }}</p>
                    <p class="deepl-config-hint">仅接受无用户名密码的 <code class="hint-code">http://</code> 或 <code class="hint-code">https://</code> CONNECT 代理，不支持 SOCKS5。启用后所有 Google 来源优先走该代理；代理故障时可能直连 Google。其他引擎和词典不使用此代理，也不会读取系统代理。</p>
                  </div>
                </template>
                <p v-if="selectedEngine === 'thirdparty-ai'" class="deepl-config-hint engine-test-note">「测试配置」按组顺序测试整条组链，成功时指出实际命中的组；各组「测试」只测该组。真实请求可能消耗额度，不计入成功率、不改变顺序。</p>
                <p v-else-if="selectedEngine === 'google'" class="deepl-config-hint engine-test-note">测试配置与正式翻译使用同一代理规则，不计入成功率。</p>
              </div>
            </Transition>
          </div>
        </div>
      </div>
        </div>

        <div
          id="settings-panel-advanced"
          class="settings-panel"
          :class="{ 'is-active': activeCategory === 'advanced' }"
          role="tabpanel"
          aria-labelledby="settings-tab-advanced"
          :aria-hidden="activeCategory === 'advanced' ? 'false' : 'true'"
        >
            <h3 class="section-title">稳定性统计</h3>
            <p class="section-hint">记录每次翻译引擎实际调用的成功/失败，跳过（未配置、服务未加载或文本超限）单独计数且不计入成功率。与日志等级无关。</p>

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
                    <span
                      class="stability-stat stability-stat-skip"
                      :title="'环境 ' + item.metrics.skipEnv + ' / 配置 ' + item.metrics.skipConfig + ' / 超长 ' + item.metrics.skipInput"
                    >跳过 {{ item.metrics.skipped }}</span>
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
            <p class="section-hint">仅保留引擎、错误类别、状态码、阶段、来源/路径等最少元数据，不含原文、凭据、代理地址或响应正文。仅保留最近记录。</p>

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
                  <div v-if="entry.category || entry.statusCode || entry.phase || entry.skipReason || entry.groupId || entry.groupIndex != null || entry.source || entry.route || entry.durationMs != null || (entry.googleAttempts && entry.googleAttempts.length)" class="log-detail">
                    <span v-if="entry.category">类别 {{ entry.category }}</span>
                    <span v-if="entry.statusCode"> · 状态 {{ entry.statusCode }}</span>
                    <span v-if="entry.phase"> · 阶段 {{ entry.phase }}</span>
                    <span v-if="entry.skipReason"> · 跳过 {{ entry.skipReason }}</span>
                    <span v-if="entry.requestId != null"> · 请求 {{ entry.requestId }}</span>
                    <span v-if="entry.groupId"> · 组 {{ entry.groupId }}</span>
                    <span v-if="entry.groupIndex != null"> · 组序号 {{ entry.groupIndex }}</span>
                    <span v-if="entry.source"> · 来源 {{ entry.source }}</span>
                    <span v-if="entry.route"> · 路径 {{ entry.route }}</span>
                    <span v-if="entry.durationMs != null"> · 耗时 {{ entry.durationMs }}ms</span>
                    <span v-if="entry.googleAttempts && entry.googleAttempts.length"> · 分源 {{ entry.googleAttempts.map(a => [a.source, a.route, a.category].filter(Boolean).join('/')).join(', ') }}</span>
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
  box-sizing: border-box;
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

.back-btn:focus-visible,
.settings-nav-item:focus-visible,
.strategy-item:focus-visible,
.toggle-switch:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

.settings-shell,
.settings-nav,
.settings-content,
.settings-panel {
  box-sizing: border-box;
}

.settings-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 10px;
  border-right: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(255, 255, 255, 0.45);
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  min-height: 0;
}

.settings-nav-item {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-secondary, #64748b);
  text-align: left;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s;
}

.settings-nav-item:hover {
  background: rgba(241, 245, 249, 1);
  color: var(--text-primary, #1e293b);
}

.settings-nav-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
  color: #4f46e5;
}

.settings-content {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.settings-panel {
  position: absolute;
  inset: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 20px 16px;
  visibility: hidden;
  pointer-events: none;
  z-index: 0;
}

.settings-panel.is-active {
  visibility: visible;
  pointer-events: auto;
  z-index: 1;
}

.settings-panel > .section-title ~ .section-title {
  margin-top: 20px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section:last-child {
  margin-bottom: 0;
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
  font-family: inherit;
  text-align: left;
  line-height: 1.4;
  color: inherit;
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

/* Engine left-right layout — independent from category sidebar */
.engine-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-width: 0;
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
.brand-baidu { background: #2932E1; }
.brand-aliyun { background: #FF6A00; }
.brand-caiyun { background: #0D9488; }

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

.engine-card-unconfigured {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-secondary, #64748b);
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

.timeout-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
}

.timeout-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeout-row-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.timeout-row-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  line-height: 1.4;
}

.timeout-input {
  width: 72px;
  flex-shrink: 0;
  padding: 8px 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  background: white;
  color: var(--text-primary, #1e293b);
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.timeout-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.probe-bar {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
}

.probe-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.probe-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 1px 2px rgba(102, 126, 234, 0.25);
  transition: transform 0.15s ease, opacity 0.2s ease;
}

.probe-btn-icon {
  width: 13px;
  height: 13px;
  display: block;
  flex-shrink: 0;
}

.probe-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.35);
}

.probe-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(102, 126, 234, 0.25);
}

.probe-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.probe-btn.is-testing:disabled {
  opacity: 1;
}

.probe-bar-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  line-height: 1.4;
}

.probe-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary, #64748b);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.probe-details-toggle:hover {
  color: var(--text-primary, #1e293b);
}

.probe-details-toggle:focus-visible {
  outline: 2px solid #667eea;
  outline-offset: 2px;
  border-radius: 2px;
}

.probe-details-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.15s ease;
}

.probe-details-icon.is-open {
  transform: rotate(180deg);
}

.probe-result-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.probe-result-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.4;
  border-bottom: 1px solid rgba(226, 232, 240, 0.5);
}

.probe-result-row:last-child {
  border-bottom: none;
}

.probe-result-name {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  min-width: 72px;
}

.probe-result-text {
  flex: 1;
  min-width: 0;
  text-align: right;
  overflow-wrap: break-word;
  word-break: break-word;
  color: var(--text-secondary, #64748b);
}

.probe-success .probe-result-text {
  color: #059669;
}

.probe-failure .probe-result-text {
  color: #dc2626;
}

.probe-skipped .probe-result-text,
.probe-pending .probe-result-text {
  color: var(--text-secondary, #64748b);
}

.probe-summary {
  margin: 8px 0 0 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-secondary, #64748b);
}

.probe-summary-success {
  color: #059669;
}

.probe-summary-noop,
.probe-summary-stale,
.probe-summary-running {
  color: var(--text-secondary, #64748b);
}

.probe-summary-save_failed {
  color: #dc2626;
}

.engine-config-area {
  flex: 1;
  min-width: 0;
}

.engine-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 9px 12px;
  margin-bottom: 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
}

.engine-config-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.engine-config-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.engine-config-heading-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.engine-config-name {
  color: var(--text-primary, #1e293b);
  font-size: 13px;
  font-weight: 600;
}

.engine-config-subtitle {
  color: var(--text-secondary, #64748b);
  font-size: 12px;
}

.engine-config-warning {
  margin: 0 0 10px;
}

.engine-test-note {
  margin-top: 8px;
}

/* 引擎配置测试：与当前引擎标题并列，避免独立悬浮在配置下方 */
.engine-test-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(99, 102, 241, 0.06);
  color: #4f46e5;
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: transform 0.15s ease, opacity 0.2s ease;
}

.engine-test-btn-icon {
  width: 13px;
  height: 13px;
  display: block;
  flex-shrink: 0;
  transition: transform 0.25s ease;
}

.engine-test-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.12);
  transform: translateY(-1px);
}

.engine-test-btn:focus-visible {
  outline: 2px solid #667eea;
  outline-offset: 2px;
}

.engine-test-btn:active:not(:disabled) {
  transform: translateY(0);
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

.engine-test-btn .engine-test-spinner {
  border-color: rgba(99, 102, 241, 0.25);
  border-top-color: currentColor;
}

@keyframes engine-test-spin {
  to { transform: rotate(360deg); }
}

.engine-test-status {
  margin: 0 0 12px;
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

.eye-toggle-text {
  min-width: 28px;
  min-height: 28px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
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

.save-failed-notice {
  margin: -4px 0 12px 0;
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
  line-height: 1.4;
}

.group-empty {
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
}

.ai-group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-group-card {
  padding: 10px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.ai-group-card.dragging {
  opacity: 0.55;
}

.ai-group-card.drag-over-before {
  box-shadow: 0 -2px 0 #667eea;
}

.ai-group-card.drag-over-after {
  box-shadow: 0 2px 0 #667eea;
}

.ai-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.ai-group-priority {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary, #64748b);
  background: rgba(226, 232, 240, 0.7);
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 6px;
  padding: 2px 6px;
}

.ai-group-name {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: white;
  color: var(--text-primary, #1e293b);
  outline: none;
  font-family: inherit;
}

.ai-group-name:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.group-mini-btn {
  flex-shrink: 0;
  padding: 4px 8px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: white;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.group-mini-btn:hover:not(:disabled) {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
}

.group-mini-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.group-mini-danger {
  color: #dc2626;
}

.group-delete-confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #dc2626;
  flex-wrap: wrap;
}

.add-group-btn {
  margin-top: 8px;
  width: 100%;
  padding: 7px 12px;
  border: 1px dashed rgba(102, 126, 234, 0.45);
  background: rgba(99, 102, 241, 0.06);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #4f46e5;
  cursor: pointer;
  font-family: inherit;
}

.add-group-btn:hover {
  opacity: 0.92;
}

.group-test-msg {
  margin: 8px 0 0 0;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: break-word;
  word-break: break-word;
}

.test-ok-text {
  color: #059669;
}

.test-fail-text {
  color: #dc2626;
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

.google-proxy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.google-proxy-error {
  margin-top: 8px;
  font-size: 12px;
  color: #dc2626;
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

.settings-panel::-webkit-scrollbar,
.settings-nav::-webkit-scrollbar {
  width: 6px;
}

.settings-panel::-webkit-scrollbar-track,
.settings-nav::-webkit-scrollbar-track {
  background: transparent;
}

.settings-panel::-webkit-scrollbar-thumb,
.settings-nav::-webkit-scrollbar-thumb {
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
.stability-stat-skip { color: #64748b; }

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

  .engine-config-header {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .engine-test-btn {
    color: #c4b5fd;
    background: rgba(99, 102, 241, 0.12);
    border-color: rgba(129, 140, 248, 0.35);
  }

  .engine-test-btn:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.2);
  }

  .engine-test-btn .engine-test-spinner {
    border-color: rgba(196, 181, 253, 0.3);
    border-top-color: currentColor;
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

  .google-proxy-error {
    color: #f87171;
  }

  .toggle-switch {
    background: rgba(71, 85, 105, 0.8);
  }

  .deepl-api-input {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
  }

  .timeout-row,
  .probe-bar {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .probe-result-row {
    border-color: rgba(51, 65, 85, 0.6);
  }

  .probe-result-name {
    color: var(--text-primary, #f1f5f9);
  }

  .probe-success .probe-result-text,
  .probe-summary-success {
    color: #34d399;
  }

  .probe-failure .probe-result-text,
  .probe-summary-save_failed {
    color: #f87171;
  }

  .timeout-row-label {
    color: var(--text-primary, #f1f5f9);
  }

  .timeout-row-desc {
    color: var(--text-secondary, #64748b);
  }

  .timeout-input {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
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

  .save-failed-notice {
    color: #f87171;
  }

  .group-empty,
  .ai-group-card {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-secondary, #94a3b8);
  }

  .ai-group-priority {
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(71, 85, 105, 0.8);
    color: var(--text-secondary, #94a3b8);
  }

  .ai-group-name,
  .group-mini-btn {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
  }

  .group-mini-danger,
  .group-delete-confirm,
  .test-fail-text {
    color: #f87171;
  }

  .test-ok-text {
    color: #34d399;
  }

  .add-group-btn {
    background: rgba(99, 102, 241, 0.12);
    border-color: rgba(99, 102, 241, 0.35);
    color: #a5b4fc;
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

  .settings-panel::-webkit-scrollbar-thumb,
  .settings-nav::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .settings-nav {
    background: rgba(15, 23, 42, 0.35);
    border-right-color: rgba(51, 65, 85, 0.6);
  }

  .settings-nav-item {
    color: var(--text-secondary, #94a3b8);
  }

  .settings-nav-item:hover {
    background: rgba(15, 23, 42, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .settings-nav-item.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
    color: #a5b4fc;
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
  .settings-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .settings-nav {
    flex-direction: row;
    flex-shrink: 0;
    gap: 6px;
    padding: 8px 12px;
    border-right: none;
    border-bottom: 1px solid rgba(226, 232, 240, 0.6);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .settings-nav-item {
    flex: 1;
    min-width: 0;
    text-align: center;
    padding: 8px 10px;
  }

  .settings-panel {
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

  .engine-config-area {
    width: 100%;
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

  .ai-group-head {
    flex-wrap: wrap;
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

  .stability-viewer-header,
  .log-viewer-header {
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  .stability-viewer-actions,
  .log-viewer-actions {
    flex-wrap: wrap;
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

@media (max-height: 599px) {
  .settings-topbar {
    padding: 8px 12px;
  }

  .settings-nav {
    padding: 6px 8px;
  }

  .settings-panel {
    padding: 12px;
  }

  .log-list {
    max-height: 220px;
  }
}

@media (prefers-color-scheme: dark) and (max-width: 768px) {
  .settings-nav {
    border-right-color: transparent;
    border-bottom-color: rgba(51, 65, 85, 0.6);
  }
}
</style>
