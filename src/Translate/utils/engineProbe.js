/**
 * 设置页「一键测试并排序」：并行探测五个故障转移引擎，按本轮耗时稳定排序。
 * 不走翻译页统计回调，也不复用成功即停的串行 failover。
 */

import {
  inspectEngineForCall,
  classifyError,
  skipUserMessage,
  attemptEngineCall,
  getRuntimeEnv,
  runMainTextTranslation,
} from './engineBridge.js'
import { KNOWN_ENGINES, snapshotEngineTimeoutMs, snapshotThirdpartyAiTimeoutMs, snapshotGoogleProxy } from './storage.js'
import {
  runThirdpartyAiGroupFailover,
  snapshotThirdpartyAiGroups,
  createGroupRequest,
} from './thirdpartyAiGroups.js'

export const PROBE_NO_SUCCESS_MESSAGE = '无可用引擎，未调整顺序'

export const PROBE_APPLY = {
  OK: 'ok',
  NO_SUCCESS: 'no_success',
  STALE: 'stale',
  SAVE_FAILED: 'save_failed',
}

const AI_PROMPT_PREFIX = 'Translate the following text to Simplified Chinese and reply with the translation only:\n'
let probeSequence = 0

function defaultNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * 本轮短英文测试句。同一轮固定；不同轮带变化标记，降低 Google 缓存命中。
 */
export function createProbeText(now = Date.now(), nonce = Math.random()) {
  const tag = `${Number(now).toString(36)}-${Math.floor(Number(nonce) * 1e9).toString(36)}-${(++probeSequence).toString(36)}`
  return `Hello World ${tag}`
}

/**
 * 测试覆盖全部已知引擎：先保留当前 failoverOrder 中的合法项，缺项按白名单补在尾部。
 */
export function resolveProbeEngines(failoverOrder) {
  const seen = new Set()
  const result = []
  if (Array.isArray(failoverOrder)) {
    for (const engine of failoverOrder) {
      if (KNOWN_ENGINES.includes(engine) && !seen.has(engine)) {
        seen.add(engine)
        result.push(engine)
      }
    }
  }
  for (const engine of KNOWN_ENGINES) {
    if (!seen.has(engine)) {
      seen.add(engine)
      result.push(engine)
    }
  }
  return result
}

function serializeGroups(groups) {
  return (groups || []).map(g => `${g.id}\0${g.name}\0${g.url}\0${g.apiKey}\0${g.model}`).join('\n')
}

export function snapshotProbeConfig(settings) {
  const s = settings || {}
  return {
    failoverOrder: Array.isArray(s.failoverOrder) ? [...s.failoverOrder] : [],
    engineResponseTimeoutSeconds: s.engineResponseTimeoutSeconds,
    thirdpartyAiFailoverTimeoutSeconds: s.thirdpartyAiFailoverTimeoutSeconds,
    deeplApiKey: s.deeplApiKey || '',
    deeplxServerUrl: s.deeplxServerUrl || '',
    deeplxToken: s.deeplxToken || '',
    thirdpartyAiGroups: snapshotThirdpartyAiGroups(s),
    thirdpartyAiSystemPrompt: s.thirdpartyAiSystemPrompt || '',
    googleProxyEnabled: !!s.googleProxyEnabled,
    googleProxyUrl: s.googleProxyUrl || '',
    baiduAppId: s.baiduAppId || '',
    baiduSecret: s.baiduSecret || '',
    aliyunAccessKeyId: s.aliyunAccessKeyId || '',
    aliyunAccessKeySecret: s.aliyunAccessKeySecret || '',
    caiyunToken: s.caiyunToken || '',
  }
}

export function isProbeConfigUnchanged(snapshot, settings) {
  if (!snapshot) return false
  const current = snapshotProbeConfig(settings)
  if (snapshot.failoverOrder.length !== current.failoverOrder.length) return false
  for (let i = 0; i < snapshot.failoverOrder.length; i++) {
    if (snapshot.failoverOrder[i] !== current.failoverOrder[i]) return false
  }
  return (
    snapshot.engineResponseTimeoutSeconds === current.engineResponseTimeoutSeconds
    && snapshot.thirdpartyAiFailoverTimeoutSeconds === current.thirdpartyAiFailoverTimeoutSeconds
    && snapshot.deeplApiKey === current.deeplApiKey
    && snapshot.deeplxServerUrl === current.deeplxServerUrl
    && snapshot.deeplxToken === current.deeplxToken
    && snapshot.thirdpartyAiSystemPrompt === current.thirdpartyAiSystemPrompt
    && snapshot.googleProxyEnabled === current.googleProxyEnabled
    && snapshot.googleProxyUrl === current.googleProxyUrl
    && snapshot.baiduAppId === current.baiduAppId
    && snapshot.baiduSecret === current.baiduSecret
    && snapshot.aliyunAccessKeyId === current.aliyunAccessKeyId
    && snapshot.aliyunAccessKeySecret === current.aliyunAccessKeySecret
    && snapshot.caiyunToken === current.caiyunToken
    && serializeGroups(snapshot.thirdpartyAiGroups) === serializeGroups(current.thirdpartyAiGroups)
  )
}

function skippedItem(engine, inspection) {
  return {
    engine,
    status: 'skipped',
    skipReason: inspection.skipReason,
    skipCategory: inspection.skipCategory,
    category: inspection.category,
    safeMessage: skipUserMessage(inspection),
    durationMs: null,
  }
}

export function inspectProbeEngines(settings = {}, env = getRuntimeEnv(), text) {
  return resolveProbeEngines(settings.failoverOrder).map((engine) => {
    const inspection = inspectEngineForCall(engine, settings, env, text)
    if (inspection.status === 'skipped') return skippedItem(engine, inspection)
    return { engine, status: 'pending', durationMs: null, safeMessage: '' }
  })
}

/**
 * 成功组按耗时从短到长；失败组随后、跳过组最后。
 * 同组（含成功组耗时相同）保持原列表相对次序。输出含全部已知引擎，无重复。
 */
export function sortByProbeResults(originalOrder, results) {
  const engines = resolveProbeEngines(originalOrder)
  const byEngine = new Map((results || []).map(item => [item.engine, item]))
  const rank = new Map(engines.map((engine, index) => [engine, index]))
  const success = []
  const failure = []
  const skipped = []

  for (const engine of engines) {
    const item = byEngine.get(engine)
    if (item && item.status === 'success') success.push(engine)
    else if (item && item.status === 'failure') failure.push(engine)
    else skipped.push(engine)
  }

  success.sort((a, b) => {
    const da = Number(byEngine.get(a).durationMs)
    const db = Number(byEngine.get(b).durationMs)
    const na = Number.isFinite(da) ? da : Number.POSITIVE_INFINITY
    const nb = Number.isFinite(db) ? db : Number.POSITIVE_INFINITY
    if (na !== nb) return na - nb
    return rank.get(a) - rank.get(b)
  })

  return [...success, ...failure, ...skipped]
}

export function applyProbeOrder({
  hadSuccess,
  stale,
  leftPage,
  nextOrder,
  persistOrder,
}) {
  if (leftPage || stale) {
    return { applied: false, persisted: false, reason: PROBE_APPLY.STALE }
  }
  if (!hadSuccess) {
    return { applied: false, persisted: false, reason: PROBE_APPLY.NO_SUCCESS }
  }
  const persisted = typeof persistOrder === 'function' ? persistOrder(nextOrder) : false
  if (!persisted) {
    return { applied: true, persisted: false, reason: PROBE_APPLY.SAVE_FAILED }
  }
  return { applied: true, persisted: true, reason: PROBE_APPLY.OK }
}

export function createProbeRunGuard() {
  let inFlight = false
  return {
    get running() {
      return inFlight
    },
    tryStart() {
      if (inFlight) return false
      inFlight = true
      return true
    },
    end() {
      inFlight = false
    },
  }
}

export function formatProbeItemText(item) {
  if (!item || item.status === 'pending') return '测试中'
  if (item.status === 'success') {
    return formatProbeSuccessText(item.durationMs, item.successGroupIndex)
  }
  if (item.status === 'skipped') return item.safeMessage || '已跳过'
  return item.safeMessage || '测试失败'
}

/**
 * 真实调用一条引擎。返回 { translation }，供 attemptEngineCall 判非空。
 * Google / DeepL / DeepLX / 第三方 AI 把 timeoutMs 传到 preload；uTools AI 无取消接口。
 */
export async function callEngineProbe(engine, { text, settings = {}, env, timeoutMs }) {
  const runtime = env || getRuntimeEnv()
  const services = (runtime && runtime.services) || {}
  const utools = (runtime && runtime.utools) || {}
  const prompt = AI_PROMPT_PREFIX + text

  switch (engine) {
    case 'ai': {
      if (typeof utools.ai !== 'function') throw new Error('翻译服务方法不可用')
      const r = await utools.ai({
        messages: [{ role: 'user', content: prompt }],
      })
      const translation = (r && r.content && String(r.content).trim()) || ''
      if (!translation) throw new Error('引擎返回空结果')
      return { translation }
    }
    case 'thirdparty-ai': {
      if (typeof services.requestThirdpartyAI !== 'function') throw new Error('翻译服务方法不可用')
      const groups = snapshotThirdpartyAiGroups(settings)
      const group = groups.find(g => g && String(g.url || '').trim() && String(g.apiKey || '').trim() && String(g.model || '').trim()) || groups[0] || {}
      const data = await services.requestThirdpartyAI(
        group.url,
        group.apiKey,
        {
          model: group.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        },
        timeoutMs,
      )
      if (data && data.error) throw new Error('自定义 AI 返回错误')
      const translation = (data?.choices?.[0]?.message?.content || '').trim()
      if (!translation) throw new Error('引擎返回空结果')
      return { translation }
    }
    case 'google': {
      if (typeof services.googleTranslate !== 'function') throw new Error('翻译服务方法不可用')
      const googleProxy = snapshotGoogleProxy(settings)
      return runMainTextTranslation(
        (value, from, to) => services.googleTranslate(value, from, to, timeoutMs, googleProxy),
        text,
        'en',
        'zh-CN',
      )
    }
    case 'deepl': {
      if (typeof services.deeplTranslate !== 'function') throw new Error('翻译服务方法不可用')
      return runMainTextTranslation(
        (value, from, to) => services.deeplTranslate(value, from, to, settings.deeplApiKey, timeoutMs),
        text,
        'en',
        'zh-CN',
      )
    }
    case 'deeplx': {
      if (typeof services.deeplxTranslate !== 'function') throw new Error('翻译服务方法不可用')
      return runMainTextTranslation(
        (value, from, to) => services.deeplxTranslate(
          value,
          from,
          to,
          settings.deeplxServerUrl,
          settings.deeplxToken,
          timeoutMs,
        ),
        text,
        'en',
        'zh-CN',
      )
    }
    case 'baidu': {
      if (typeof services.baiduTranslate !== 'function') throw new Error('翻译服务方法不可用')
      return runMainTextTranslation(
        (value, from, to) => services.baiduTranslate(
          value,
          from,
          to,
          settings.baiduAppId,
          settings.baiduSecret,
          timeoutMs,
        ),
        text,
        'en',
        'zh-CN',
      )
    }
    case 'aliyun': {
      if (typeof services.aliyunTranslate !== 'function') throw new Error('翻译服务方法不可用')
      return runMainTextTranslation(
        (value, from, to) => services.aliyunTranslate(
          value,
          from,
          to,
          settings.aliyunAccessKeyId,
          settings.aliyunAccessKeySecret,
          timeoutMs,
        ),
        text,
        'en',
        'zh-CN',
      )
    }
    case 'caiyun': {
      if (typeof services.caiyunTranslate !== 'function') throw new Error('翻译服务方法不可用')
      return runMainTextTranslation(
        (value, from, to) => services.caiyunTranslate(
          value,
          from,
          to,
          settings.caiyunToken,
          timeoutMs,
        ),
        text,
        'en',
        'zh-CN',
      )
    }
    default:
      throw new Error('未知引擎')
  }
}

function settleDuration(start, now) {
  const elapsed = now() - start
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
}

function formatProbeSuccessText(durationMs, groupIndex) {
  const ms = Math.round(Number(durationMs))
  const timeText = Number.isFinite(ms) ? `成功 ${ms} ms` : '成功'
  if (!Number.isInteger(groupIndex) || groupIndex < 0) return timeText
  return `${timeText}（组 ${groupIndex + 1}）`
}

async function probeThirdpartyAiEngine({
  settings,
  env,
  text,
  now,
  translateWith,
  isCurrent,
}) {
  const groupTimeout = snapshotThirdpartyAiTimeoutMs(settings)
  const start = now()
  if (typeof translateWith === 'function') {
    // 注入路径代表整引擎一次调用（测试用），用二级时限结算，不用一级时限截断。
    const result = await attemptEngineCall(
      () => translateWith('thirdparty-ai', text, groupTimeout),
      'thirdparty-ai',
      groupTimeout,
    )
    return {
      status: 'success',
      durationMs: settleDuration(start, now),
      successGroupIndex: Number.isInteger(result && result.successGroupIndex) ? result.successGroupIndex : undefined,
    }
  }
  const chain = await runThirdpartyAiGroupFailover({
    groups: snapshotThirdpartyAiGroups(settings),
    timeoutMs: groupTimeout,
    env,
    isCurrent,
    requestGroup: createGroupRequest({
      env,
      includeSystemPrompt: false,
      messages: [{ role: 'user', content: AI_PROMPT_PREFIX + text }],
    }),
  })
  const durationMs = settleDuration(start, now)
  if (chain && chain.stale) {
    return { status: 'stale', durationMs }
  }
  if (chain && chain.success) {
    return {
      status: 'success',
      durationMs,
      successGroupIndex: chain.groupIndex,
    }
  }
  if (chain && chain.allSkipped) {
    const last = (chain.outcomes || []).find(o => o.status === 'skipped') || {}
    return {
      status: 'skipped',
      durationMs: null,
      skipReason: last.skipReason,
      skipCategory: last.skipCategory,
      category: last.category,
      safeMessage: skipUserMessage(last),
    }
  }
  const lastFail = [...(chain && chain.outcomes || [])].reverse().find(o => o.status === 'failure') || {}
  const classified = lastFail.category
    ? lastFail
    : classifyError(new Error(chain && chain.message || '自定义 AI 调用失败'))
  return {
    status: 'failure',
    durationMs,
    category: classified.category,
    statusCode: classified.statusCode,
    safeMessage: classified.safeMessage,
  }
}

/**
 * 并行探测：跳过不发请求；ready 引擎各一次真实调用，独立时限，只结算一次。
 */
export async function runBatchEngineProbe({
  settings = {},
  env,
  timeoutMs,
  text,
  now = defaultNow,
  translateWith,
  onItem,
  isCurrent = () => true,
} = {}) {
  const runtime = env || getRuntimeEnv()
  const engines = resolveProbeEngines(settings.failoverOrder)
  const n = Number(timeoutMs)
  const budget = Number.isFinite(n) && n > 0 ? n : snapshotEngineTimeoutMs(settings)
  const probeText = text || createProbeText()
  const originalOrder = Array.isArray(settings.failoverOrder) ? [...settings.failoverOrder] : []

  const results = engines.map((engine) => {
    const inspection = inspectEngineForCall(engine, settings, runtime, probeText)
    if (inspection.status === 'skipped') {
      const item = skippedItem(engine, inspection)
      onItem?.(item)
      return item
    }
    return { engine, status: 'pending', durationMs: null, safeMessage: '' }
  })

  const pendingIndexes = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'pending') pendingIndexes.push(i)
  }

  await Promise.all(pendingIndexes.map(async (index) => {
    const engine = results[index].engine
    if (engine === 'thirdparty-ai') {
      try {
        const probed = await probeThirdpartyAiEngine({
          settings,
          env: runtime,
          text: probeText,
          now,
          translateWith,
          isCurrent,
        })
        if (typeof isCurrent === 'function' && !isCurrent()) {
          results[index] = { engine, status: 'stale', durationMs: probed.durationMs }
          return
        }
        const item = { engine, ...probed }
        results[index] = item
        if (item.status !== 'stale') onItem?.(item)
      } catch (err) {
        const classified = classifyError(err)
        const item = {
          engine,
          status: 'failure',
          durationMs: null,
          category: classified.category,
          statusCode: classified.statusCode,
          safeMessage: classified.safeMessage,
        }
        if (typeof isCurrent === 'function' && !isCurrent()) {
          results[index] = { engine, status: 'stale', durationMs: null }
          return
        }
        results[index] = item
        onItem?.(item)
      }
      return
    }
    let start = now()
    try {
      const caller = (target) => {
        start = now()
        if (typeof translateWith === 'function') return translateWith(target, probeText, budget)
        return callEngineProbe(target, {
          text: probeText,
          settings,
          env: runtime,
          timeoutMs: budget,
        })
      }
      await attemptEngineCall(caller, engine, budget)
      const item = {
        engine,
        status: 'success',
        durationMs: settleDuration(start, now),
      }
      if (typeof isCurrent === 'function' && !isCurrent()) {
        results[index] = { engine, status: 'stale', durationMs: item.durationMs }
        return
      }
      results[index] = item
      onItem?.(item)
    } catch (err) {
      const classified = classifyError(err)
      const item = {
        engine,
        status: 'failure',
        durationMs: settleDuration(start, now),
        category: classified.category,
        statusCode: classified.statusCode,
        safeMessage: classified.safeMessage,
      }
      if (typeof isCurrent === 'function' && !isCurrent()) {
        results[index] = { engine, status: 'stale', durationMs: item.durationMs }
        return
      }
      results[index] = item
      onItem?.(item)
    }
  }))

  const finalResults = results.map((item) => {
    if (item.status !== 'pending') return item
    return {
      engine: item.engine,
      status: 'failure',
      durationMs: null,
      category: 'timeout',
      statusCode: null,
      safeMessage: '引擎请求超时',
    }
  })

  const hadSuccess = finalResults.some(item => item.status === 'success')
  const nextOrder = hadSuccess ? sortByProbeResults(originalOrder, finalResults) : originalOrder

  return {
    results: finalResults,
    hadSuccess,
    nextOrder,
    originalOrder,
    timeoutMs: budget,
  }
}
