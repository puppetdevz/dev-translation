<script lang="ts" setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import InputArea from './components/InputArea.vue'
import ResultDisplay from './components/ResultDisplay.vue'
import {
  buildChineseToEnglishPrompt,
  buildEnglishToChinesePrompt,
  buildPolishPrompt
} from './prompts/index.js'
import { useSettings } from './utils/useSettings.js'
import { snapshotEngineTimeoutMs, snapshotThirdpartyAiTimeoutMs } from './utils/storage.js'
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
  wordLookupTarget,
  canApplyDictionarySupplement,
  DICT_ENGINES,
  SKIP_REASON,
  PHASE,
} from './utils/engineBridge.js'

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

// AI 语言检测
const detectLanguageByAI = async (text) => {
  const result = await window.utools.ai({
    messages: [{ role: 'user', content: `只回复 "zh" 或 "en"，检测以下文本的语言：\n${text.slice(0, 300)}` }]
  })
  const content = (result && result.content && result.content.trim().toLowerCase()) || ''
  return content.includes('zh') ? 'zh' : 'en'
}

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
        const lang = await detectLanguageByAI(text)
        // 仅当本次仍是最新检测时回填，否则丢弃（防止旧慢请求覆盖新结果）
        if (myVersion === detectionVersion) {
          detectedLanguage.value = lang
        }
      } catch (err) {
        logger.warn('ai', 'AI 语言检测失败', { category: 'unknown', phase: 'call' })
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
  detectionVersion++ // 让任何 inflight AI 检测回调失效
}

// 手动切换语言方向
const handleLanguageToggle = () => {
  detectedLanguage.value = detectedLanguage.value === 'zh' ? 'en' : 'zh'
  isManualOverride.value = true
}

// 右键重新自动识别
const handleLanguageRedetect = () => {
  isManualOverride.value = false
  cancelDetection()
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

const translateWithGoogle = async (timeoutMs) => {
  const { fromLang, toLang } = prepareTranslateDirection()
  return runMainTextTranslation(
    (text, from, to) => window.services.googleTranslate(text, from, to, timeoutMs),
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
    case 'google': return translateWithGoogle(timeoutMs)
    case 'deepl': return translateWithDeepL(timeoutMs)
    case 'deeplx': return translateWithDeepLX(timeoutMs)
    case 'thirdparty-ai': return translateWithThirdpartyAI(settingsSnap, requestId)
    case 'ai':
    default: return translateWithAI()
  }
}

const supplementDictionary = async ({ engine, result, requestId, sourceText, lang, type }) => {
  if (!DICT_ENGINES[engine]) return
  const word = wordLookupTarget({
    type,
    lang,
    sourceText,
    translation: result && result.translation,
  })
  if (!word) return
  const dict = await safeLookupWord(word)
  if (!canApplyDictionarySupplement({
    isCurrent: () => requestId === translateRequestId,
    engine,
    usedEngine: usedEngine.value,
    translation: result && result.translation,
    currentTranslation: translationResult.value && translationResult.value.translation,
  })) return
  translationResult.value = {
    ...translationResult.value,
    phonetic: dict.phonetic || translationResult.value.phonetic || '',
    definitions: (dict.definitions && dict.definitions.length)
      ? dict.definitions
      : (translationResult.value.definitions || []),
    examples: (dict.examples && dict.examples.length)
      ? dict.examples
      : (translationResult.value.examples || []),
  }
}

const translate = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要翻译的内容'
    return
  }

  if (inputText.value.length > 5000) {
    error.value = '文本过长，请控制在5000字符以内'
    return
  }

  isLoading.value = true
  error.value = ''
  translationResult.value = null
  fallbackNotice.value = ''
  usedEngine.value = ''
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  // 标记本次翻译请求；旧慢请求完成后若令牌已过期则丢弃结果
  const myRequestId = ++translateRequestId

  try {
    const order = (settings.failoverOrder && Array.isArray(settings.failoverOrder) && settings.failoverOrder.length > 0)
      ? [...settings.failoverOrder]
      : ['ai']
    const timeoutMs = snapshotEngineTimeoutMs(settings)
    const settingsSnap = {
      ...settings,
      failoverOrder: order,
      thirdpartyAiGroups: snapshotThirdpartyAiGroups(settings),
      thirdpartyAiSystemPrompt: settings.thirdpartyAiSystemPrompt || '',
      thirdpartyAiFailoverTimeoutSeconds: settings.thirdpartyAiFailoverTimeoutSeconds,
      deeplApiKey: settings.deeplApiKey,
      deeplxServerUrl: settings.deeplxServerUrl,
      deeplxToken: settings.deeplxToken,
    }

    const outcome = await runEngineFailover({
      order,
      settings: settingsSnap,
      timeoutMs,
      translateWith: (engine) => translateWithEngine(engine, timeoutMs, settingsSnap, myRequestId),
      isCurrent: () => myRequestId === translateRequestId,
      onSkip: (engine, inspection, meta) => {
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
        })
      },
      onSuccess: (engine, result, index) => {
        translationResult.value = result
        usedEngine.value = engine
        logger.info(engine, '翻译成功', { phase: PHASE.CALL, requestId: myRequestId })
        recordEngineResult(engine, true)
        if (index > 0) {
          fallbackNotice.value = `${engineDisplayName(order[0])} 不可用，已切换到 ${engineDisplayName(engine)}`
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

// 润色函数
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

  try {
    const lang = detectLanguage(inputText.value)
    const prompt = buildPolishPrompt(inputText.value, lang)

    const result = await window.utools.ai({
      messages: [{ role: 'user', content: prompt }]
    })

    // 清理可能的 markdown 代码块
    let polished = result.content.trim()
    polished = polished.replace(/^```[\w]*\n/, '').replace(/\n```$/, '')

    originalText.value = inputText.value
    polishedText.value = polished
  } catch (err) {
    logger.error('ai', '文本润色失败', { category: 'unknown', phase: PHASE.CALL })
    error.value = '润色失败，请重试'
  } finally {
    isPolishing.value = false
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

// Footer 快捷切换可循环的引擎顺序（与 SettingsPage 拖拽可配置范围保持一致，含 5 引擎）
const FOOTER_ENGINE_CYCLE = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx']

const toggleTranslationEngine = () => {
  const order = (settings.failoverOrder && settings.failoverOrder.length) ? [...settings.failoverOrder] : ['ai']
  const current = order[0]
  const nextIndex = (FOOTER_ENGINE_CYCLE.indexOf(current) + 1) % FOOTER_ENGINE_CYCLE.length
  const next = FOOTER_ENGINE_CYCLE[nextIndex]
  // 移除已存在的 next，再插入首位
  const filtered = order.filter(e => e !== next)
  const newOrder = [next, ...filtered]
  updateSetting('failoverOrder', newOrder)
}

// 主引擎 → 简短标签（用于 footer 按钮显示文案，紧凑空间用缩短前缀）
const mainEngineShortLabel = (main) => {
  if (main === 'google') return 'Google'
  if (main === 'deepl') return 'DeepL'
  if (main === 'deeplx') return 'DeepLX'
  if (main === 'thirdparty-ai') return '自定义'
  return 'uTools'
}

// 本次成功翻译所用引擎的展示名（用于结果区小徽章，帮助用户判断各引擎可用性）
const usedEngineLabel = computed(() => {
  const e = usedEngine.value
  if (!e) return ''
  const names = { ai: 'uTools AI', 'thirdparty-ai': '自定义 AI', google: 'Google', deepl: 'DeepL', deeplx: 'DeepLX' }
  return names[e] || e
})

const engineLabel = computed(() => {
  const main = (settings.failoverOrder && settings.failoverOrder[0]) || 'ai'
  if (main === 'google') return 'Google 翻译引擎模式'
  if (main === 'deepl') return 'DeepL 翻译引擎模式'
  if (main === 'deeplx') return 'DeepLX 翻译引擎模式'
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
  // 让进行中的翻译请求失效，防止其完成后回填已清空的 translationResult
  translateRequestId++
  translationResult.value = null
  error.value = ''
  detectedLanguage.value = ''
  inputType.value = 'word'
  polishedText.value = ''
  originalText.value = ''
  usedEngine.value = ''
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
    // 输入为空时，重置所有状态，并使进行中的翻译请求失效，避免旧结果回填
    cancelDetection()
    translateRequestId++
    isManualOverride.value = false
    detectedLanguage.value = ''
    inputType.value = 'word'
    translationResult.value = null
    error.value = ''
    polishedText.value = ''
    originalText.value = ''
    usedEngine.value = ''
  }
})

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
          @retry="handleRetry"
        />
      </div>
    </div>

    <div class="translate-footer">
      <div class="footer-left">
        <button
          class="engine-toggle-btn"
          :class="{ active: settings.failoverOrder && settings.failoverOrder[0] && settings.failoverOrder[0] !== 'ai' }"
          @click="toggleTranslationEngine"
          :aria-label="engineLabel"
        >
          <span>{{ mainEngineShortLabel((settings.failoverOrder && settings.failoverOrder[0]) || 'ai') }}</span>
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
