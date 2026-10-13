<script lang="ts" setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import InputArea from './components/InputArea.vue'
import ResultDisplay from './components/ResultDisplay.vue'
import {
  buildChineseToEnglishPrompt,
  buildEnglishToChinesePrompt,
  buildPolishPrompt,
  normalizePolishText,
  buildLanguageDetectionMessages,
  normalizeDetectionCode,
} from './prompts/index.js'
import { useSettings } from './utils/useSettings.js'
import { snapshotEngineTimeoutMs, snapshotThirdpartyAiTimeoutMs, snapshotGoogleProxy } from './utils/storage.js'
import {
  cloneEngineEnabled,
  getEnabledAiSources,
  getEnabledEngineOrder,
  getPrimaryEnabledEngine,
  rotateEnabledOrder,
} from './utils/engineAvailability.js'
import { runAiTaskFailover } from './utils/aiTaskFailover.js'
import {
  runThirdpartyAiGroupFailover,
  snapshotThirdpartyAiGroups,
} from './utils/thirdpartyAiGroups.js'
import { logger } from './utils/logger.js'
import { recordEngineResult, recordEngineSkip } from './utils/engineStats.js'
import {
  runEngineFailover,
  safeLookupWord,
  engineDisplayName,
  runMainTextTranslation,
  canApplyDictionarySupplement,
  canPromoteMisclassifiedPhrase,
  safeLookupLocalDictionary,
  dictionaryLookupTarget,
  waitWithBudget,
  mergeDictionarySupplement,
  hasUsablePhonetic,
  hasConfirmedUsPhonetic,
  hasUsableDefinitions,
  pickLocalDefinitions,
  dictionaryStatusAfterBudget,
  isDictionaryWriteExpired,
  DICTIONARY_BUDGET_MS,
  DICT_ENGINES,
  SKIP_REASON,
  PHASE,
  NO_ENABLED_ENGINE_MESSAGE,
} from './utils/engineBridge.js'
import {
  AI_NAMING_STATUS,
  AI_NAMING_TOTAL_BUDGET_MS,
  exceedsAiNamingInputLimit,
  runAiNaming,
} from './utils/aiNaming.js'
import { buildAiNamingMessages } from './prompts/aiNaming.js'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

// 设置状态
const router = useRouter()
const { settings, toggleSetting, updateSetting } = useSettings()

// 核心状态
const inputText = ref('')
const detectedLanguage = ref('')
const isManualOverride = ref(false)
const inputType = ref('word') // 'word' 或 'sentence'
const translationResult = ref(null)
const isLoading = ref(false)
const error = ref('')

// 降级提示状态
const fallbackNotice = ref('')
let fallbackTimer = null
// 本次成功翻译最终使用的引擎标识（如 'ai'/'deepl' 等），用于结果区显示，方便用户感知各引擎稳定性
const usedEngine = ref('')
// 翻译请求令牌：每次翻译自增，结果回填前校验是否仍是最新请求，丢弃旧慢请求的覆盖
let translateRequestId = 0

// 词典补全字段状态：idle | loading | available | unavailable | hidden（按字段独立）
const dictionaryStatus = ref({ phonetic: 'idle', definitions: 'idle' })
// 词典补全版本：重新翻译、改输入/方向、清空或卸载都会让旧补全回填失效
let dictionaryRequestVersion = 0
let dictionaryTimer = null

// AI 命名状态：独立于主翻译与词典补全，默认关闭；仅在开启后按需请求
const aiNamingStatus = ref('off')
const aiNamingWords = ref([])
const aiNamingMessage = ref('')
let aiNamingVersion = 0
// 最近一次成功翻译的快照：只有匹配当前输入/方向的成功译文才能补生成或重试命名
let aiNamingSnapshot = null
// 同一输入/方向/译文/配置下防止重复生成（开启事件与翻译成功事件防重）
let aiNamingActiveKey = ''

// 润色相关状态
const isPolishing = ref(false)
const polishedText = ref('')
const originalText = ref('')

// 语言检测
const detectLanguage = (text) => {
  if (!text || !text.trim()) return ''
  const chineseChars = text.match(/[一-龥]/g)
  const chineseRatio = chineseChars ? chineseChars.length / text.length : 0
  return chineseRatio > 0.3 ? 'zh' : 'en'
}

// 检测降级提示：只在当前有效轮次 AI 全部耗尽时提示一次，旧轮次不提示。
const detectionNotice = ref('')
let detectionNoticeTimer = null
const showDetectionNotice = (message) => {
  detectionNotice.value = message
  if (detectionNoticeTimer) clearTimeout(detectionNoticeTimer)
  detectionNoticeTimer = setTimeout(() => {
    detectionNotice.value = ''
    detectionNoticeTimer = null
  }, 4000)
}
const clearDetectionNotice = () => {
  if (detectionNoticeTimer) {
    clearTimeout(detectionNoticeTimer)
    detectionNoticeTimer = null
  }
  detectionNotice.value = ''
}

/** 辅助 AI 任务（检测/润色）启动时捕获的设置快照，只影响随后启动的操作。 */
const aiTaskSettingsSnapshot = () => ({
  engineEnabled: cloneEngineEnabled(settings.engineEnabled),
  failoverOrder: Array.isArray(settings.failoverOrder) ? [...settings.failoverOrder] : [],
  thirdpartyAiGroups: snapshotThirdpartyAiGroups(settings),
  engineResponseTimeoutSeconds: settings.engineResponseTimeoutSeconds,
  thirdpartyAiFailoverTimeoutSeconds: settings.thirdpartyAiFailoverTimeoutSeconds,
})

// 统一检测入口（AI 策略含 500ms 防抖）
let detectionTimer = null
// 检测版本号：每次发起检测自增，回调回填时校验版本是否最新，避免旧慢请求覆盖新结果
let detectionVersion = 0
const runDetection = (text) => {
  if (!text || !text.trim()) return
  if (settings.detectionStrategy === 'ai') {
    clearTimeout(detectionTimer)
    const myVersion = ++detectionVersion
    detectionTimer = setTimeout(async () => {
      try {
        const snap = aiTaskSettingsSnapshot()
        const outcome = await runAiTaskFailover({
          sources: getEnabledAiSources(snap),
          settings: snap,
          messages: buildLanguageDetectionMessages(text),
          validate: (raw) => {
            const code = normalizeDetectionCode(raw)
            return code ? { ok: true, value: code } : { ok: false }
          },
          timeoutMs: snapshotEngineTimeoutMs(snap),
          groupTimeoutMs: snapshotThirdpartyAiTimeoutMs(snap),
          isCurrent: () => myVersion === detectionVersion,
          onAttempt: (payload) => {
            if (payload.status === 'skipped') {
              logger.warn(payload.source, 'AI 语言检测来源跳过', {
                category: payload.category,
                skipReason: payload.skipReason,
                skipCategory: payload.skipCategory,
                phase: PHASE.SKIP,
                requestId: myVersion,
                groupId: payload.groupId,
              })
              return
            }
            if (payload.status === 'failure') {
              logger.warn(payload.source, 'AI 语言检测失败', {
                category: payload.category,
                phase: payload.phase,
                requestId: myVersion,
                groupId: payload.groupId,
              })
            }
          },
        })
        // 仅当前轮次有效时才回填；旧轮次不提示、不覆盖
        if (myVersion !== detectionVersion) return
        if (outcome.stale) return
        if (outcome.success) {
          detectedLanguage.value = outcome.value
          return
        }
        // 无开启 AI 来源或全部耗尽：当前轮次只提示一次，回退本地字符规则；不修改保存的检测策略
        detectedLanguage.value = detectLanguage(text)
        showDetectionNotice('AI 语言检测不可用，已按本地规则判断方向')
        logger.warn('ai', 'AI 语言检测降级', {
          category: 'unknown',
          phase: PHASE.FALLBACK,
          requestId: myVersion,
        })
      } catch (err) {
        if (myVersion !== detectionVersion) return
        detectedLanguage.value = detectLanguage(text)
        showDetectionNotice('AI 语言检测不可用，已按本地规则判断方向')
        logger.warn('ai', 'AI 语言检测降级', {
          category: 'unknown',
          phase: PHASE.FALLBACK,
          requestId: myVersion,
        })
      }
    }, 500)
  } else {
    detectedLanguage.value = detectLanguage(text)
  }
}

// 取消挂起的检测定时器与 inflight AI 检测（版本号失效后回调自动丢弃）
const cancelDetection = () => {
  if (detectionTimer) {
    clearTimeout(detectionTimer)
    detectionTimer = null
  }
  clearDetectionNotice()
  detectionVersion++ // 让任何 inflight AI 检测回调失效
}

// 手动切换语言方向
const handleLanguageToggle = () => {
  detectedLanguage.value = detectedLanguage.value === 'zh' ? 'en' : 'zh'
  isManualOverride.value = true
  // 方向变化：旧资料补全、旧 AI 命名与旧润色结果均失效
  polishVersion++
  resetDictionaryState()
  clearAiNamingState()
}

// 右键重新自动识别
const handleLanguageRedetect = () => {
  isManualOverride.value = false
  cancelDetection()
  // 重新识别会改变方向，旧资料、旧命名与旧润色结果都不能继续代表当前状态
  polishVersion++
  resetDictionaryState()
  clearAiNamingState()
  runDetection(inputText.value)
}

// 输入类型检测：单词/词组 vs 句子
const detectInputType = (text) => {
  if (!text || !text.trim()) return 'word'

  const trimmed = text.trim()

  // 检测中文
  const chineseChars = trimmed.match(/[一-龥]/g)
  const isChinese = chineseChars && chineseChars.length / trimmed.length > 0.3

  if (isChinese) {
    // 中文：检测是否有标点符号（句子特征）
    const hasSentencePunctuation = /[。！？；，、]/.test(trimmed)
    // 检测字数（中文词组通常较短）
    const charCount = trimmed.length
    // 如果有句子标点或字数超过阈值，认为是句子
    return (hasSentencePunctuation || charCount > 10) ? 'sentence' : 'word'
  } else {
    // 英文：检测单词数量
    const words = trimmed.split(/\s+/).filter(w => w.length > 0)
    // 检测是否有句子标点
    const hasSentencePunctuation = /[.!?;,\n]/.test(trimmed)

    // 如果有句子标点或单词数超过阈值，认为是句子
    return (hasSentencePunctuation || words.length > 5) ? 'sentence' : 'word'
  }
}

// 解析 AI 响应
const parseResult = (aiResponse, type) => {
  // 内部辅助：从字符串中尝试多种方式提取 JSON 对象
  const tryExtractJson = (raw) => {
    // 直接解析
    try {
      return JSON.parse(raw)
    } catch (e) {
      // 继续尝试其他方式
    }
    // 提取 ```json 代码块
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1])
      } catch (e) {
        // 继续尝试其他方式
      }
    }
    // 提取花括号内容
    const braceMatch = raw.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0])
      } catch (e) {
        // 继续尝试其他方式
      }
    }
    return null
  }

  const result = tryExtractJson(aiResponse)

  if (result && result.translation) {
    // 句子模式只需 translation 字段
    if (type === 'sentence') {
      return result
    }
    // 单词/词组模式：兼容旧格式（definitions 字符串数组）
    // 旧格式缺 examples 字段时补默认空数组，避免丢弃可渲染的翻译结果
    if (result.definitions && result.definitions.length > 0 && typeof result.definitions[0] === 'string') {
      if (!Array.isArray(result.examples)) {
        result.examples = []
      }
    }
    return result
  }

  // 三种 JSON 提取均失败：把原始内容当作纯文本译文降级返回（第三方模型可能不遵守 JSON 指令）
  // 仅当内容非空时降级；空内容仍抛错（避免静默成功返回空译文）
  const text = (aiResponse || '').trim()
  if (text) {
    // 清理可能的 markdown 代码块包裹
    const cleaned = text.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim()
    if (cleaned) {
      return { translation: cleaned }
    }
  }

  throw new Error('无法解析翻译结果，请重试')
}

const prepareTranslateDirection = () => {
  const lang = detectedLanguage.value || detectLanguage(inputText.value)
  detectedLanguage.value = lang
  const type = detectInputType(inputText.value)
  inputType.value = type
  const isEnToZh = lang === 'en'
  return {
    lang,
    type,
    fromLang: isEnToZh ? 'en' : 'zh-CN',
    toLang: isEnToZh ? 'zh-CN' : 'en',
  }
}

const translateWithGoogle = async (timeoutMs, settingsSnap) => {
  const { fromLang, toLang } = prepareTranslateDirection()
  const googleProxy = snapshotGoogleProxy(settingsSnap || settings)
  return runMainTextTranslation(
    (text, from, to) => window.services.googleTranslate(text, from, to, timeoutMs, googleProxy),
    inputText.value.trim(),
    fromLang,
    toLang,
  )
}

const translateWithDictEngine = async (translateFn) => {
  const { fromLang, toLang } = prepareTranslateDirection()
  return runMainTextTranslation(translateFn, inputText.value.trim(), fromLang, toLang)
}

// DeepL 官方 API 翻译（独立顶级引擎）。桥接可用性由 inspectEngine 在调度前检查。
const translateWithDeepL = async (timeoutMs) => {
  return translateWithDictEngine(
    (text, from, to) => window.services.deeplTranslate(text, from, to, settings.deeplApiKey, timeoutMs)
  )
}

// DeepLX 翻译（自部署/公共实例，独立顶级引擎）
const translateWithDeepLX = async (timeoutMs) => {
  return translateWithDictEngine(
    (text, from, to) => window.services.deeplxTranslate(text, from, to, settings.deeplxServerUrl, settings.deeplxToken, timeoutMs)
  )
}

const translateWithBaidu = async (timeoutMs, settingsSnap) => {
  return translateWithDictEngine(
    (text, from, to) => window.services.baiduTranslate(
      text,
      from,
      to,
      settingsSnap.baiduAppId,
      settingsSnap.baiduSecret,
      timeoutMs,
    )
  )
}

const translateWithAliyun = async (timeoutMs, settingsSnap) => {
  return translateWithDictEngine(
    (text, from, to) => window.services.aliyunTranslate(
      text,
      from,
      to,
      settingsSnap.aliyunAccessKeyId,
      settingsSnap.aliyunAccessKeySecret,
      timeoutMs,
    )
  )
}

const translateWithCaiyun = async (timeoutMs, settingsSnap) => {
  return translateWithDictEngine(
    (text, from, to) => window.services.caiyunTranslate(
      text,
      from,
      to,
      settingsSnap.caiyunToken,
      timeoutMs,
    )
  )
}

// AI 翻译（语言检测、prompt 构建、utools.ai 调用、parseResult）
const translateWithAI = async () => {
  const lang = detectedLanguage.value || detectLanguage(inputText.value)
  detectedLanguage.value = lang

  const type = detectInputType(inputText.value)
  inputType.value = type

  const prompt = lang === 'zh'
    ? buildChineseToEnglishPrompt(inputText.value, type)
    : buildEnglishToChinesePrompt(inputText.value, type)

  const result = await window.utools.ai({
    messages: [{ role: 'user', content: prompt }]
  })

  // AI 翻译不调用词典查询，phonetic/definitions/examples 来自 parseResult
  return parseResult(result.content, type)
}

// 自定义 AI 翻译：按快照中的组顺序二级故障转移，共用系统提示词，不受一级时限截断
const translateWithThirdpartyAI = async (settingsSnap, requestId) => {
  const groups = snapshotThirdpartyAiGroups(settingsSnap)
  const timeoutMs = snapshotThirdpartyAiTimeoutMs(settingsSnap)
  const systemPrompt = (settingsSnap && settingsSnap.thirdpartyAiSystemPrompt) || ''

  const lang = detectedLanguage.value || detectLanguage(inputText.value)
  detectedLanguage.value = lang

  const type = detectInputType(inputText.value)
  inputType.value = type

  const userPrompt = lang === 'zh'
    ? buildChineseToEnglishPrompt(inputText.value, type)
    : buildEnglishToChinesePrompt(inputText.value, type)

  const messages = []
  if (systemPrompt && String(systemPrompt).trim()) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: userPrompt })

  const chain = await runThirdpartyAiGroupFailover({
    groups,
    timeoutMs,
    isCurrent: () => requestId === translateRequestId,
    onGroupSkip: (group, inspection, index) => {
      logger.warn('thirdparty-ai', inspection.safeMessage, {
        category: inspection.category,
        skipReason: inspection.skipReason,
        skipCategory: inspection.skipCategory,
        phase: PHASE.SKIP,
        requestId,
        groupId: group && group.id,
        groupIndex: index,
      })
    },
    onGroupFailure: (group, classified, index) => {
      logger.error('thirdparty-ai', classified.safeMessage, {
        category: classified.category,
        statusCode: classified.statusCode,
        phase: PHASE.CALL,
        requestId,
        groupId: group && group.id,
        groupIndex: index,
      })
    },
    requestGroup: async (group, budget) => {
      const data = await window.services.requestThirdpartyAI(
        group.url,
        group.apiKey,
        { model: group.model, messages, stream: false },
        budget,
      )
      if (data && data.error) throw new Error('自定义 AI 返回错误')
      const content = data?.choices?.[0]?.message?.content || ''
      if (!content) throw new Error('自定义 AI 返回空结果')
      return parseResult(content, type)
    },
  })

  if (chain && chain.stale) {
    const err = new Error('引擎请求超时')
    err.stale = true
    throw err
  }
  if (chain && chain.success) return chain.result
  const lastFail = [...((chain && chain.outcomes) || [])].reverse().find(o => o.status === 'failure')
  const err = new Error((lastFail && lastFail.safeMessage) || (chain && chain.message) || '自定义 AI 调用失败')
  if (lastFail && lastFail.statusCode) err.statusCode = lastFail.statusCode
  throw err
}

// 引擎调度函数
const translateWithEngine = async (engine, timeoutMs, settingsSnap, requestId) => {
  switch (engine) {
    case 'google': return translateWithGoogle(timeoutMs, settingsSnap)
    case 'deepl': return translateWithDeepL(timeoutMs)
    case 'deeplx': return translateWithDeepLX(timeoutMs)
    case 'baidu': return translateWithBaidu(timeoutMs, settingsSnap)
    case 'aliyun': return translateWithAliyun(timeoutMs, settingsSnap)
    case 'caiyun': return translateWithCaiyun(timeoutMs, settingsSnap)
    case 'thirdparty-ai': return translateWithThirdpartyAI(settingsSnap, requestId)
    case 'ai':
    default: return translateWithAI()
  }
}

const idleDictionaryStatus = (result, lang) => ({
  phonetic: settings.showPhonetic
    ? (hasConfirmedUsPhonetic(result && result.phonetic, result && result.phoneticRegion) ? 'available' : 'idle')
    : 'hidden',
  definitions: settings.showDefinitions
    ? (hasUsableDefinitions(result && result.definitions, lang) ? 'available' : 'idle')
    : 'hidden',
})

const clearDictionaryTimer = () => {
  if (dictionaryTimer) {
    clearTimeout(dictionaryTimer)
    dictionaryTimer = null
  }
}

/** 清空词典补全状态，并让进行中的补全失效。 */
const resetDictionaryState = () => {
  dictionaryRequestVersion++
  clearDictionaryTimer()
  dictionaryStatus.value = { phonetic: 'idle', definitions: 'idle' }
}

const publishDictionaryStatus = (result, lang) => {
  dictionaryStatus.value = dictionaryStatusAfterBudget({
    showPhonetic: settings.showPhonetic,
    showDefinitions: settings.showDefinitions,
    result,
    lang,
  })
}

/**
 * 词典资料补全（独立于主翻译与 AI 命名）：
 * 主译文先展示 → 记录输入/方向/引擎/译文快照 → 本地词库补缺 → 必要时单词在线补缺
 * → 校验请求与截止时间 → 字段级合并 → 更新字段状态。
 * 整段补全从启动起最长 DICTIONARY_BUDGET_MS；到期保留已取得字段，其余转最终缺失。
 */
const supplementDictionary = async ({ engine, result, requestId, sourceText, lang, type }) => {
  const source = String(sourceText || '').trim()
  const translation = (result && result.translation) || ''
  const phoneticConfirmed = hasConfirmedUsPhonetic(result && result.phonetic, result && result.phoneticRegion)
  const needPhonetic = !!settings.showPhonetic && !phoneticConfirmed
  const needDefinitions = !!settings.showDefinitions && !hasUsableDefinitions(result && result.definitions, lang)
  const target = dictionaryLookupTarget({ type, lang, sourceText: source, translation })

  // 全部资料栏目关闭、或没有可补全的字段/目标时不发起补全（也不为 AI 命名负责）
  if ((!needPhonetic && !needDefinitions) || !target.target) {
    dictionaryStatus.value = idleDictionaryStatus(result, lang)
    return
  }

  const myVersion = ++dictionaryRequestVersion
  const deadline = Date.now() + DICTIONARY_BUDGET_MS
  const stillOwner = () => myVersion === dictionaryRequestVersion && requestId === translateRequestId
  const identityOk = () => canApplyDictionarySupplement({
    isCurrent: () => true,
    engine,
    usedEngine: usedEngine.value,
    translation,
    currentTranslation: translationResult.value && translationResult.value.translation,
    sourceText: source,
    currentSourceText: inputText.value,
    lang,
    currentLang: detectedLanguage.value,
  })
  const releaseIfReplaced = () => {
    if (!stillOwner()) return true
    if (!identityOk()) {
      dictionaryStatus.value = { phonetic: 'idle', definitions: 'idle' }
      clearDictionaryTimer()
      return true
    }
    return false
  }

  clearDictionaryTimer()
  dictionaryTimer = setTimeout(() => {
    dictionaryTimer = null
    if (!stillOwner()) return
    publishDictionaryStatus(translationResult.value, detectedLanguage.value)
  }, DICTIONARY_BUDGET_MS)

  dictionaryStatus.value = {
    phonetic: settings.showPhonetic ? (needPhonetic ? 'loading' : 'available') : 'hidden',
    definitions: settings.showDefinitions ? (needDefinitions ? 'loading' : 'available') : 'hidden',
  }

  // 单词/词组先撤下无法确认的音标，避免补全期间把无地区或英式音标显示成美式。
  // 句子在确认是误判词组之前保持原样，不借机改写整句旧行为。
  if (type !== 'sentence' && needPhonetic && translationResult.value && hasUsablePhonetic(translationResult.value.phonetic)) {
    translationResult.value = { ...translationResult.value, phonetic: '', phoneticRegion: '' }
  }

  let acceptedLocal = null
  const localBudget = deadline - Date.now()
  if (localBudget > 0) {
    try {
      const entry = await waitWithBudget(safeLookupLocalDictionary(target.target), localBudget)
      if (!isDictionaryWriteExpired(deadline)) acceptedLocal = entry
    } catch {
      acceptedLocal = null
    }
  }
  if (releaseIfReplaced()) return

  const promoted = canPromoteMisclassifiedPhrase({
    type,
    sourceText: source,
    target: target.target,
    localEntry: acceptedLocal,
  })
  // 真正的句子不写入词库资料；只有长度阈值误判且整组命中的词组才提升为单词展示。
  if (type === 'sentence' && !promoted) {
    if (stillOwner()) {
      clearDictionaryTimer()
      dictionaryStatus.value = idleDictionaryStatus(result, lang)
    }
    return
  }
  if (promoted) inputType.value = 'word'

  const isLocalPhrase = !!(acceptedLocal && acceptedLocal.found && acceptedLocal.kind === 'phrase')
  const localDefinitions = pickLocalDefinitions(acceptedLocal, lang)
  const singleWordTarget = !/\s/.test(target.target)
  const missingExamples = !!settings.showExamples
    && !(Array.isArray(result && result.examples) && result.examples.length)
  const onlineAllowed = target.allowNetwork
    && !target.phraseOnly
    && !isLocalPhrase
    && singleWordTarget
    && ((needDefinitions && !localDefinitions.length) || missingExamples)

  let acceptedOnline = null
  if (onlineAllowed) {
    const remaining = deadline - Date.now()
    if (remaining > 0) {
      const entry = await waitWithBudget(
        safeLookupWord(target.target, undefined, remaining),
        remaining,
      )
      if (!isDictionaryWriteExpired(deadline)) acceptedOnline = entry
    }
  }
  if (releaseIfReplaced()) return
  if (!stillOwner()) return

  const merged = mergeDictionarySupplement({
    result: translationResult.value || result,
    localEntry: acceptedLocal,
    onlineEntry: acceptedOnline,
    lang,
  })
  if (releaseIfReplaced()) return
  clearDictionaryTimer()
  const next = { ...translationResult.value, ...merged.result }
  // 写回时已关闭的栏目不接收晚到资料，避免之后重新打开时被补全结果弹出来。
  if (!settings.showPhonetic) {
    next.phonetic = translationResult.value && translationResult.value.phonetic
    next.phoneticRegion = translationResult.value && translationResult.value.phoneticRegion
  }
  if (!settings.showDefinitions) {
    next.definitions = translationResult.value && translationResult.value.definitions
  }
  if (!settings.showExamples) {
    next.examples = translationResult.value && translationResult.value.examples
  }
  translationResult.value = next
  publishDictionaryStatus(next, lang)
}

// ===== AI 命名（独立分支，默认关闭） =====

const aiNamingSnapshotKey = (snapshot, settingsSnap) => JSON.stringify([
  snapshot && snapshot.input,
  snapshot && snapshot.lang,
  snapshot && snapshot.translation,
  snapshot && snapshot.engine,
  settingsSnap.failoverOrder,
  settingsSnap.engineEnabled,
  settingsSnap.thirdpartyAiGroups,
])

/** 只有与当前输入、方向、成功引擎和主译文完全匹配的译文才可用于命名。 */
const matchesCurrentSnapshot = (snapshot) => {
  if (!snapshot) return false
  if (!translationResult.value || translationResult.value.translation !== snapshot.translation) return false
  if (usedEngine.value !== snapshot.engine) return false
  if (inputText.value.trim() !== snapshot.input) return false
  if (detectedLanguage.value !== snapshot.lang) return false
  return true
}

const clearAiNamingState = ({ invalidate = true } = {}) => {
  if (invalidate) aiNamingVersion++
  aiNamingStatus.value = 'off'
  aiNamingWords.value = []
  aiNamingMessage.value = ''
  aiNamingActiveKey = ''
}

/**
 * 生成 AI 命名：使用本次 settings 快照的 AI 来源顺序，独立 10 秒总预算。
 * 关闭开关、输入/方向/译文/配置变化都会通过版本号让旧响应失效。
 */
const startAiNaming = async (snapshot) => {
  if (!settings.showAiNaming || !snapshot) return
  if (!matchesCurrentSnapshot(snapshot)) return

  if (exceedsAiNamingInputLimit(snapshot.input)) {
    aiNamingVersion++
    aiNamingActiveKey = ''
    aiNamingStatus.value = AI_NAMING_STATUS.TOO_LONG
    aiNamingWords.value = []
    aiNamingMessage.value = ''
    return
  }

  const settingsSnap = {
    failoverOrder: Array.isArray(settings.failoverOrder) ? [...settings.failoverOrder] : [],
    engineEnabled: cloneEngineEnabled(settings.engineEnabled),
    thirdpartyAiGroups: snapshotThirdpartyAiGroups(settings),
    thirdpartyAiFailoverTimeoutSeconds: settings.thirdpartyAiFailoverTimeoutSeconds,
  }
  const key = aiNamingSnapshotKey(snapshot, settingsSnap)
  const settledStates = [
    AI_NAMING_STATUS.LOADING,
    AI_NAMING_STATUS.READY,
    AI_NAMING_STATUS.NONE,
    AI_NAMING_STATUS.FAILED,
    AI_NAMING_STATUS.TIMEOUT,
    AI_NAMING_STATUS.UNCONFIGURED,
    AI_NAMING_STATUS.TOO_LONG,
    AI_NAMING_STATUS.STALE,
  ]
  if (key === aiNamingActiveKey && settledStates.includes(aiNamingStatus.value)) return

  const myVersion = ++aiNamingVersion
  aiNamingActiveKey = key
  aiNamingStatus.value = AI_NAMING_STATUS.LOADING
  aiNamingWords.value = []
  aiNamingMessage.value = ''

  const sources = getEnabledAiSources(settingsSnap)
  const result = await runAiNaming({
    sources,
    settings: settingsSnap,
    messages: buildAiNamingMessages({
      text: snapshot.input,
      lang: snapshot.lang,
      translation: snapshot.translation,
    }),
    budgetMs: AI_NAMING_TOTAL_BUDGET_MS,
    groupTimeoutMs: snapshotThirdpartyAiTimeoutMs(settingsSnap),
    isCurrent: () => myVersion === aiNamingVersion && matchesCurrentSnapshot(snapshot) && settings.showAiNaming,
    onAttempt: (payload) => {
      if (payload.status === 'skipped') {
        logger.warn(payload.source, 'AI 命名来源跳过', {
          category: payload.category,
          skipReason: payload.skipReason,
          skipCategory: payload.skipCategory,
          phase: PHASE.SKIP,
          requestId: myVersion,
          groupId: payload.groupId,
        })
        return
      }
      if (payload.status === 'failure') {
        logger.error(payload.source, 'AI 命名调用失败', {
          category: payload.category,
          phase: payload.phase,
          requestId: myVersion,
          groupId: payload.groupId,
        })
        return
      }
      logger.info(payload.source, 'AI 命名成功', {
        phase: PHASE.CALL,
        requestId: myVersion,
        groupId: payload.groupId,
      })
    },
  })

  if (myVersion !== aiNamingVersion) return
  if (!matchesCurrentSnapshot(snapshot) || !settings.showAiNaming) {
    // 版本仍归本次请求，但方向或译文已不匹配时不能把「生成中」留在界面上
    if (aiNamingStatus.value === AI_NAMING_STATUS.LOADING) {
      aiNamingStatus.value = 'off'
      aiNamingWords.value = []
      aiNamingMessage.value = ''
      aiNamingActiveKey = ''
    }
    return
  }
  aiNamingStatus.value = result.status
  aiNamingWords.value = Array.isArray(result.words) ? result.words : []
  aiNamingMessage.value = result.message || ''
}

/** 行内重试：只重新发起命名，不重新翻译、不重新查询词典；加载中禁止重复触发。 */
const handleRetryNaming = () => {
  const snapshot = aiNamingSnapshot
  if (!snapshot || !settings.showAiNaming) return
  if (aiNamingStatus.value === AI_NAMING_STATUS.LOADING) return
  if (!matchesCurrentSnapshot(snapshot)) return
  aiNamingActiveKey = ''
  void startAiNaming(snapshot)
}

const translate = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要翻译的内容'
    return
  }

  // 有效顺序在启动时快照：合法全关时明确无引擎，不发任何请求、不隐式恢复 uTools AI
  const order = getEnabledEngineOrder(settings)
  if (order.length === 0) {
    isLoading.value = false
    translationResult.value = null
    usedEngine.value = ''
    error.value = NO_ENABLED_ENGINE_MESSAGE
    return
  }

  isLoading.value = true
  error.value = ''
  translationResult.value = null
  fallbackNotice.value = ''
  usedEngine.value = ''
  // 已提交的翻译方向以本次检测为准，输入过程中的慢检测不得事后改写方向
  cancelDetection()
  // 新翻译开始时让旧补全/旧命名失效并清空状态
  resetDictionaryState()
  clearAiNamingState()
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  // 标记本次翻译请求；旧慢请求完成后若令牌已过期则丢弃结果
  const myRequestId = ++translateRequestId

  try {
    const timeoutMs = snapshotEngineTimeoutMs(settings)
    const settingsSnap = {
      ...settings,
      failoverOrder: [...order],
      engineEnabled: cloneEngineEnabled(settings.engineEnabled),
      thirdpartyAiGroups: snapshotThirdpartyAiGroups(settings),
      thirdpartyAiSystemPrompt: settings.thirdpartyAiSystemPrompt || '',
      thirdpartyAiFailoverTimeoutSeconds: settings.thirdpartyAiFailoverTimeoutSeconds,
      deeplApiKey: settings.deeplApiKey,
      deeplxServerUrl: settings.deeplxServerUrl,
      deeplxToken: settings.deeplxToken,
      baiduAppId: settings.baiduAppId,
      baiduSecret: settings.baiduSecret,
      aliyunAccessKeyId: settings.aliyunAccessKeyId,
      aliyunAccessKeySecret: settings.aliyunAccessKeySecret,
      caiyunToken: settings.caiyunToken,
    }

    let primaryInputLimited = false
    const outcome = await runEngineFailover({
      order,
      settings: settingsSnap,
      timeoutMs,
      text: inputText.value.trim(),
      translateWith: (engine) => translateWithEngine(engine, timeoutMs, settingsSnap, myRequestId),
      isCurrent: () => myRequestId === translateRequestId,
      onSkip: (engine, inspection, meta) => {
        if (engine === order[0] && inspection.skipReason === SKIP_REASON.INPUT_LIMIT) primaryInputLimited = true
        recordEngineSkip(engine, inspection.skipCategory)
        if (inspection.skipReason === SKIP_REASON.BRIDGE_MISSING) {
          if (meta && meta.notifyOnce) {
            logger.error('system', '翻译服务未加载', {
              category: inspection.category,
              skipReason: inspection.skipReason,
              skipCategory: inspection.skipCategory,
              phase: PHASE.SKIP,
              requestId: myRequestId,
            })
          }
          return
        }
        logger.warn(engine, inspection.safeMessage, {
          category: inspection.category,
          skipReason: inspection.skipReason,
          skipCategory: inspection.skipCategory,
          phase: PHASE.SKIP,
          requestId: myRequestId,
        })
      },
      onFailure: (engine, classified) => {
        recordEngineResult(engine, false)
        logger.error(engine, classified.safeMessage, {
          category: classified.category,
          statusCode: classified.statusCode,
          phase: PHASE.CALL,
          requestId: myRequestId,
          source: classified.source,
          route: classified.route,
          durationMs: classified.durationMs,
          googleAttempts: classified.googleAttempts,
        })
      },
      onSuccess: (engine, result, index) => {
        translationResult.value = result
        usedEngine.value = engine
        const snapshot = {
          input: inputText.value.trim(),
          lang: detectedLanguage.value,
          translation: result && result.translation,
          engine,
        }
        aiNamingSnapshot = snapshot
        logger.info(engine, '翻译成功', { phase: PHASE.CALL, requestId: myRequestId })
        recordEngineResult(engine, true)
        if (index > 0) {
          fallbackNotice.value = primaryInputLimited
            ? `文本超过该引擎单次限制，已切换到 ${engineDisplayName(engine)}`
            : `${engineDisplayName(order[0])} 不可用，已切换到 ${engineDisplayName(engine)}`
          if (fallbackTimer) clearTimeout(fallbackTimer)
          fallbackTimer = setTimeout(() => {
            fallbackNotice.value = ''
            fallbackTimer = null
          }, 3000)
        }
        void supplementDictionary({
          engine,
          result,
          requestId: myRequestId,
          sourceText: inputText.value.trim(),
          lang: detectedLanguage.value,
          type: inputType.value,
        })
        // 词典补全与 AI 命名是两条独立异步分支，互不等待、互不影响
        if (settings.showAiNaming) void startAiNaming(snapshot)
      },
    })

    if (outcome.stale || myRequestId !== translateRequestId) {
      return
    }
    if (outcome.success) {
      return
    }
    error.value = outcome.message || '翻译失败，请重试'
    logger.error('system', outcome.message || '所有引擎均失败', {
      category: 'unknown',
      phase: PHASE.FALLBACK,
      requestId: myRequestId,
    })
  } catch (err) {
    if (myRequestId !== translateRequestId) {
      return
    }
    error.value = '翻译失败，请重试'
    logger.error('system', '翻译流程异常', {
      category: 'unknown',
      phase: PHASE.CALL,
      requestId: myRequestId,
    })
  } finally {
    // 仅当本次仍是最新请求时才解除 loading，避免新请求的 loading 被旧请求清掉
    if (myRequestId === translateRequestId) {
      isLoading.value = false
    }
  }
}

// 关闭降级提示
const dismissFallbackNotice = () => {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  fallbackNotice.value = ''
}

// 润色版本：清空/改输入/切方向/离页/新轮次都会让旧响应失效
let polishVersion = 0

// 润色函数：使用开启的 AI 来源按优先级回退，任务专用校验；失败不自动替换输入
const polish = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要润色的内容'
    return
  }

  if (inputText.value.length > 5000) {
    error.value = '文本过长，请控制在5000字符以内'
    return
  }

  isPolishing.value = true
  error.value = ''
  const myVersion = ++polishVersion
  const sourceText = inputText.value
  const lang = detectLanguage(sourceText)

  try {
    const snap = aiTaskSettingsSnapshot()
    const outcome = await runAiTaskFailover({
      sources: getEnabledAiSources(snap),
      settings: snap,
      messages: [{ role: 'user', content: buildPolishPrompt(sourceText, lang) }],
      validate: (raw) => {
        const text = normalizePolishText(raw)
        return text ? { ok: true, value: text } : { ok: false }
      },
      timeoutMs: snapshotEngineTimeoutMs(snap),
      groupTimeoutMs: snapshotThirdpartyAiTimeoutMs(snap),
      isCurrent: () => myVersion === polishVersion,
      onAttempt: (payload) => {
        if (payload.status === 'skipped') {
          logger.warn(payload.source, '文本润色来源跳过', {
            category: payload.category,
            skipReason: payload.skipReason,
            skipCategory: payload.skipCategory,
            phase: PHASE.SKIP,
            requestId: myVersion,
            groupId: payload.groupId,
          })
          return
        }
        if (payload.status === 'failure') {
          logger.warn(payload.source, '文本润色失败', {
            category: payload.category,
            phase: payload.phase,
            requestId: myVersion,
            groupId: payload.groupId,
          })
        }
      },
    })
    if (myVersion !== polishVersion) return
    if (outcome.stale) return
    if (!outcome.success) {
      // 全部耗尽：提示一次，保留原输入，不产出伪造结果
      logger.error('ai', '文本润色失败', { category: 'unknown', phase: PHASE.FALLBACK, requestId: myVersion })
      error.value = '润色失败，请重试'
      return
    }
    // 结果回填前再确认输入与方向未变，旧结果不覆盖新状态
    if (inputText.value !== sourceText || detectLanguage(inputText.value) !== lang) return
    originalText.value = sourceText
    polishedText.value = outcome.value
  } catch (err) {
    if (myVersion !== polishVersion) return
    logger.error('ai', '文本润色失败', { category: 'unknown', phase: PHASE.CALL })
    error.value = '润色失败，请重试'
  } finally {
    if (myVersion === polishVersion) isPolishing.value = false
  }
}

// 采纳润色结果
const handleAcceptPolish = () => {
  inputText.value = polishedText.value
  polishedText.value = ''
  originalText.value = ''
  // 重置手动覆盖锁：润色后文本可能语言不同，让自动检测重新接管，避免锁定在旧方向
  isManualOverride.value = false
  cancelDetection()
  // 更新语言检测
  detectedLanguage.value = detectLanguage(inputText.value)
}

// 拒绝润色结果
const handleRejectPolish = () => {
  polishedText.value = ''
  originalText.value = ''
}

// 打开设置页面
const openSettings = () => {
  router.push({ name: 'settings' })
}

// 切换变量命名模式
const toggleVariableNaming = () => {
  toggleSetting('showVariableNaming')
}

// 有效主引擎：首个开启项；全部关闭时为 null（不隐式回退 uTools AI）
const mainEngine = computed(() => getPrimaryEnabledEngine(settings))

// 快捷切换：只轮换开启项，关闭项保持原位与相对次序，不因轮换被启用
const openSettingsEngine = () => {
  router.push({ name: 'settings', query: { category: 'engine' } })
}

const toggleTranslationEngine = () => {
  const { order, changed } = rotateEnabledOrder(settings)
  if (!order.length || !changed) {
    // 无开启项：不进设置页的引擎分类，不伪装成 uTools 主引擎
    if (getEnabledEngineOrder(settings).length === 0) openSettingsEngine()
    return
  }
  updateSetting('failoverOrder', order)
}

// 主引擎 → 简短标签（用于 footer 按钮显示文案，紧凑空间用缩短前缀）
const mainEngineShortLabel = (main) => {
  if (!main) return '无启用'
  if (main === 'google') return 'Google'
  if (main === 'deepl') return 'DeepL'
  if (main === 'deeplx') return 'DeepLX'
  if (main === 'baidu') return '百度'
  if (main === 'aliyun') return '阿里'
  if (main === 'caiyun') return '彩云'
  if (main === 'thirdparty-ai') return '自定义'
  return 'uTools'
}

// 本次成功翻译所用引擎的展示名（用于结果区小徽章，帮助用户判断各引擎可用性）
const usedEngineLabel = computed(() => {
  const e = usedEngine.value
  if (!e) return ''
  const names = {
    ai: 'uTools AI',
    'thirdparty-ai': '自定义 AI',
    google: 'Google',
    deepl: 'DeepL',
    deeplx: 'DeepLX',
    baidu: '百度',
    aliyun: '阿里',
    caiyun: '彩云',
  }
  return names[e] || e
})

const engineLabel = computed(() => {
  const main = mainEngine.value
  if (!main) return '无启用引擎，点击前往设置开启'
  if (main === 'google') return 'Google 翻译引擎模式'
  if (main === 'deepl') return 'DeepL 翻译引擎模式'
  if (main === 'deeplx') return 'DeepLX 翻译引擎模式'
  if (main === 'baidu') return '百度翻译引擎模式'
  if (main === 'aliyun') return '阿里翻译引擎模式'
  if (main === 'caiyun') return '彩云小译引擎模式'
  if (main === 'thirdparty-ai') return '自定义 AI 翻译引擎模式'
  return 'uTools AI 翻译引擎模式'
})

// 打开 GitHub 仓库
const openGitHub = () => {
  window.utools.shellOpenExternal('https://github.com/puppetdevz/dev-translation')
}

// 清空输入
const handleClear = () => {
  inputText.value = ''
  // 取消挂起的检测定时器与 inflight AI 检测，防止清空后回填 detectedLanguage
  cancelDetection()
  // 让进行中的翻译/润色请求失效，防止其完成后回填已清空的 translationResult
  translateRequestId++
  polishVersion++
  translationResult.value = null
  error.value = ''
  detectedLanguage.value = ''
  inputType.value = 'word'
  polishedText.value = ''
  originalText.value = ''
  usedEngine.value = ''
  // 清空后不复活旧资料/旧命名，也不保留空占位
  resetDictionaryState()
  clearAiNamingState()
  aiNamingSnapshot = null
}

// 重试
const handleRetry = () => {
  translate()
}

// 监听输入变化，实时检测语言并在输入为空时重置输出
watch(inputText, (newValue) => {
  if (newValue && newValue.trim()) {
    if (!isManualOverride.value) {
      runDetection(newValue)
    }
    // 注意：不在 watch 中提前 detectInputType —— 该值仅在 translate 时被消费（translateWithX 内部统一设置），
    // 此处提前计算每次按键都同步跑多正则是浪费；ResultDisplay 也仅在 result 存在时才读取 inputType
  } else {
    // 输入为空时，重置所有状态，并使进行中的翻译/润色请求失效，避免旧结果回填
    cancelDetection()
    translateRequestId++
    polishVersion++
    isManualOverride.value = false
    detectedLanguage.value = ''
    inputType.value = 'word'
    translationResult.value = null
    error.value = ''
    polishedText.value = ''
    originalText.value = ''
    usedEngine.value = ''
    resetDictionaryState()
    clearAiNamingState()
    aiNamingSnapshot = null
  }
})

// 输入变化：旧资料补全、旧 AI 命名与旧润色结果失效（不在输入过程中实时请求命名）
watch(inputText, () => {
  polishVersion++
  resetDictionaryState()
  clearAiNamingState()
})

// AI 命名开关：关闭即失效并清除；由关闭变开启且当前输入仍有匹配的成功译文时补生成一次
watch(() => settings.showAiNaming, (enabled) => {
  if (!enabled) {
    clearAiNamingState()
    return
  }
  if (aiNamingSnapshot && matchesCurrentSnapshot(aiNamingSnapshot)) {
    aiNamingActiveKey = ''
    void startAiNaming(aiNamingSnapshot)
  }
})

// AI 来源顺序/组配置变化：旧命名失效但不自动重发，保留可重试入口
watch(
  () => [
    (settings.failoverOrder || []).join(','),
    JSON.stringify(snapshotThirdpartyAiGroups(settings)),
    settings.thirdpartyAiFailoverTimeoutSeconds,
  ].join('|'),
  () => {
    aiNamingVersion++
    aiNamingActiveKey = ''
    if (!settings.showAiNaming) return
    if (aiNamingStatus.value === 'off') return
    aiNamingWords.value = []
    aiNamingMessage.value = ''
    if (aiNamingSnapshot && matchesCurrentSnapshot(aiNamingSnapshot)) {
      aiNamingStatus.value = AI_NAMING_STATUS.STALE
    } else {
      aiNamingStatus.value = 'off'
    }
  },
)

// 处理文本选择进入
watch(() => props.enterAction, (action) => {
  if (action.type === 'over' && action.payload) {
    inputText.value = action.payload
    nextTick(() => translate())
  }
}, { immediate: true })

// 组件卸载时清理定时器，防止回调写入已销毁组件的 ref
onUnmounted(() => {
  cancelDetection()
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  translateRequestId++ // 让任何 inflight 翻译完成后丢弃结果
  polishVersion++ // 让 inflight 润色丢弃回填
  dictionaryRequestVersion++ // 让 inflight 词典补全丢弃回填
  clearDictionaryTimer()
  aiNamingVersion++ // 让 inflight AI 命名丢弃回填
})
</script>

<template>
  <div class="translate-container">
    <div class="translate-content">
      <div class="translate-input-section">
        <InputArea
          v-model="inputText"
          :detectedLanguage="detectedLanguage"
          :isManualOverride="isManualOverride"
          :isLoading="isLoading"
          :isPolishing="isPolishing"
          :polishedText="polishedText"
          :usedEngineLabel="usedEngineLabel"
          :detectionNotice="detectionNotice"
          @translate="translate"
          @clear="handleClear"
          @polish="polish"
          @acceptPolish="handleAcceptPolish"
          @rejectPolish="handleRejectPolish"
          @languageToggle="handleLanguageToggle"
          @languageRedetect="handleLanguageRedetect"
        />
      </div>

      <div class="translate-result-section">
        <div v-if="fallbackNotice" class="fallback-notice">
          <span class="fallback-notice-text">{{ fallbackNotice }}</span>
          <button class="fallback-notice-close" @click="dismissFallbackNotice" aria-label="关闭提示">×</button>
        </div>
        <ResultDisplay
          :result="translationResult"
          :isLoading="isLoading"
          :error="error"
          :inputType="inputType"
          :originalText="inputText"
          :detectedLanguage="detectedLanguage"
          :settings="settings"
          :dictionaryStatus="dictionaryStatus"
          :aiNamingStatus="aiNamingStatus"
          :aiNamingWords="aiNamingWords"
          :aiNamingMessage="aiNamingMessage"
          @retry="handleRetry"
          @retry-naming="handleRetryNaming"
        />
      </div>
    </div>

    <div class="translate-footer">
      <div class="footer-left">
        <button
          class="engine-toggle-btn"
          :class="{ active: !!mainEngine && mainEngine !== 'ai' }"
          @click="toggleTranslationEngine"
          :aria-label="engineLabel"
        >
          <span>{{ mainEngineShortLabel(mainEngine) }}</span>
        </button>
        <button
          class="var-naming-btn"
          :class="{ active: settings.showVariableNaming }"
          @click="toggleVariableNaming"
          aria-label="编程变量模式"
        >
          <span>&lt;/&gt;</span>
        </button>
      </div>
      <div class="footer-center">
        <a class="github-star-link" @click="openGitHub">⭐ 好用就 Star，不好用提 Issue</a>
      </div>
      <button class="settings-btn" @click="openSettings" title="设置">
        <span>⚙️</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.translate-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  position: relative;
}

/* 设置按钮 */
.settings-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.settings-btn:hover {
  background: white;
  transform: translateY(-1px) rotate(45deg);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.translate-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
}

.translate-input-section {
  flex: 0 0 50%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.translate-result-section {
  flex: 0 0 50%;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* 自定义滚动条 - 输出区域 */
.translate-result-section::-webkit-scrollbar {
  width: 8px;
}

.translate-result-section::-webkit-scrollbar-track {
  background: transparent;
}

.translate-result-section::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.translate-result-section::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

.translate-footer {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(226, 232, 240, 0.6);
  display: grid;
  grid-template-columns: auto 1fr 32px;
  align-items: center;
  gap: 8px;
  position: relative;
}

.footer-center {
  display: flex;
  justify-content: center;
  align-items: center;
}

.github-star-link {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
  user-select: none;
}

.github-star-link:hover {
  color: #6366f1;
  transform: translateY(-1px);
}

.var-naming-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.var-naming-btn:hover {
  background: white;
  border-color: rgba(99, 102, 241, 0.4);
  color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.var-naming-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}

.var-naming-btn::after,
.engine-toggle-btn::after {
  content: attr(aria-label);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  transform: translateY(4px);
  z-index: 20;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.92);
  color: white;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
}

.var-naming-btn::before,
.engine-toggle-btn::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 3px);
  left: 12px;
  transform: translateY(4px) rotate(45deg);
  z-index: 19;
  width: 8px;
  height: 8px;
  background: rgba(15, 23, 42, 0.92);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.var-naming-btn:hover::after,
.var-naming-btn:focus-visible::after,
.engine-toggle-btn:hover::after,
.engine-toggle-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.var-naming-btn:hover::before,
.var-naming-btn:focus-visible::before,
.engine-toggle-btn:hover::before,
.engine-toggle-btn:focus-visible::before {
  opacity: 1;
  transform: translateY(0) rotate(45deg);
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.engine-toggle-btn {
  position: relative;
  min-width: 62px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.engine-toggle-btn:hover {
  background: white;
  border-color: rgba(99, 102, 241, 0.4);
  color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.engine-toggle-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}

/* 降级提示条 */
.fallback-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: #fffbeb;
  border: 1px solid rgba(251, 191, 36, 0.5);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  color: #92400e;
  font-size: 12px;
  line-height: 1.4;
  animation: fallback-notice-fade-in 0.3s ease;
}

.fallback-notice-text {
  flex: 1;
  min-width: 0;
}

.fallback-notice-close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #92400e;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.fallback-notice-close:hover {
  background: rgba(251, 191, 36, 0.2);
}

@keyframes fallback-notice-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-color-scheme: dark) {
  .fallback-notice {
    background: rgba(146, 64, 14, 0.2);
    border-color: rgba(251, 191, 36, 0.3);
    color: #fcd34d;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .fallback-notice-close {
    color: #fcd34d;
  }

  .fallback-notice-close:hover {
    background: rgba(251, 191, 36, 0.15);
  }

  .translate-container {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .translate-footer {
    background: rgba(30, 41, 59, 0.8);
    border-top: 1px solid rgba(51, 65, 85, 0.6);
  }

  .settings-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .settings-btn:hover {
    background: #1e293b;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .var-naming-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .var-naming-btn:hover {
    background: #1e293b;
    border-color: rgba(99, 102, 241, 0.5);
    color: #a5b4fc;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .var-naming-btn.active {
    background: #6366f1;
    border-color: #6366f1;
    color: white;
  }

  .engine-toggle-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .engine-toggle-btn:hover {
    background: #1e293b;
    border-color: rgba(99, 102, 241, 0.5);
    color: #a5b4fc;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .engine-toggle-btn.active {
    background: #6366f1;
    border-color: #6366f1;
    color: white;
  }

  .github-star-link:hover {
    color: #a5b4fc;
  }

  .translate-result-section::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .translate-result-section::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

/* 响应式布局 */
@media (max-width: 768px) {
  .translate-content {
    padding: 12px 16px;
    gap: 12px;
  }

  .translate-footer {
    padding: 10px 16px;
  }
}

/* 小窗口优化 - uTools 默认窗口 */
@media (max-height: 550px) {
  .translate-content {
    padding: 10px;
    gap: 10px;
  }

  .translate-footer {
    display: none;
  }
}

/* 超小窗口优化 */
@media (max-height: 400px) {
  .translate-content {
    padding: 6px 12px;
    gap: 8px;
  }
}
</style>
