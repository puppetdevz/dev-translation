/**
 * AI 命名：严格协议解析、来源过滤、独立总预算与状态机。
 *
 * 与翻译路径完全隔离：
 * - 不复用翻译提示词，也不复用面向翻译的 parseResult 契约；
 * - 每个已调用的 AI 来源/组都受「本轮命名 10 秒总预算」约束，预算内才继续回退；
 * - 结果按结构化 words 校验，失败不影响主翻译、词典补全与引擎统计。
 */

import {
  ERROR_CATEGORY,
  SKIP_CATEGORY,
  SKIP_REASON,
  getRuntimeEnv,
} from './engineBridge.js'
import {
  inspectThirdpartyAiGroup,
  snapshotThirdpartyAiGroups,
} from './thirdpartyAiGroups.js'
import { AI_NAMING_SYSTEM_CONTRACT } from '../prompts/aiNaming.js'

/** 每轮命名（首次生成与每次重试）的独立总预算。 */
export const AI_NAMING_TOTAL_BUDGET_MS = 10000
/** 原始输入 trim 后的 Unicode 码点上限。 */
export const AI_NAMING_INPUT_MAX_CHARS = 200
/** 只按顺序中的 AI 来源命名；普通翻译引擎不承担语义命名。 */
export const AI_NAMING_SOURCES = ['ai', 'thirdparty-ai']
export const AI_NAMING_MAX_WORDS = 4

export const AI_NAMING_STATUS = {
  OFF: 'off',
  LOADING: 'loading',
  READY: 'ready',
  NONE: 'none',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  UNCONFIGURED: 'unconfigured',
  TOO_LONG: 'too-long',
  STALE: 'stale',
}

export const AI_NAMING_UNCONFIGURED_MESSAGE = '未配置可用的 AI 来源，请在设置中检查已有 AI 配置与顺序'
export const AI_NAMING_BRIDGE_MISSING_MESSAGE = '翻译服务未加载，AI 命名不可用；请重载插件或确认安装版本'

/** 按 Unicode 码点计数（非 BMP 字符算 1 个）。 */
export function countUnicodeCodePoints(text) {
  return Array.from(String(text == null ? '' : text)).length
}

/** trim 后超过 200 码点时不截断、不请求。 */
export function exceedsAiNamingInputLimit(text) {
  return countUnicodeCodePoints(String(text == null ? '' : text).trim()) > AI_NAMING_INPUT_MAX_CHARS
}

/** 过滤出顺序中的 AI 来源，保持相对顺序。 */
export function filterAiNamingSources(failoverOrder) {
  const order = Array.isArray(failoverOrder) ? failoverOrder : []
  return order.filter(engine => AI_NAMING_SOURCES.includes(engine))
}

/**
 * 严格校验词元：以英文字母开头、后续仅字母或数字；拒绝中文、标点、空值和乱码。
 * @returns {string[]} 合法词元（小写去重）；含非法元素时返回空数组
 */
export function sanitizeNamingWords(raw) {
  if (!Array.isArray(raw)) return []
  if (!raw.length || raw.length > AI_NAMING_MAX_WORDS) return []
  const out = []
  for (const item of raw) {
    if (typeof item !== 'string') return []
    const word = item.trim()
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(word)) return []
    const lower = word.toLowerCase()
    if (!out.includes(lower)) out.push(lower)
  }
  return out
}

function tryExtractJson(raw) {
  const text = String(raw == null ? '' : raw)
  try {
    return JSON.parse(text)
  } catch {
    // 继续尝试其他方式
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) {
    try {
      return JSON.parse(fence[1])
    } catch {
      // 继续尝试其他方式
    }
  }
  const brace = text.match(/\{[\s\S]*\}/)
  if (brace) {
    try {
      return JSON.parse(brace[0])
    } catch {
      // 继续尝试其他方式
    }
  }
  return null
}

/**
 * 解析 AI 命名响应。多层提取只用于容错取 JSON，取到后仍严格校验类型与内容。
 * @returns {{ok: true, shouldName: boolean, words: string[]} | {ok: false, reason: string}}
 */
export function parseNamingResponse(raw) {
  const parsed = tryExtractJson(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_json' }
  }
  if (typeof parsed.shouldName !== 'boolean') {
    return { ok: false, reason: 'invalid_should_name' }
  }
  if (parsed.shouldName === false) {
    return { ok: true, shouldName: false, words: [] }
  }
  const words = sanitizeNamingWords(parsed.words)
  if (!words.length) return { ok: false, reason: 'invalid_words' }
  return { ok: true, shouldName: true, words }
}

function raceWithBudget(run, budgetMs) {
  let settled = false
  const call = Promise.resolve().then(run)
  call.catch(() => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const err = new Error('AI 命名超时')
      err.timedOut = true
      reject(err)
    }, Math.max(1, budgetMs))
    call.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err || new Error('AI 命名调用失败'))
      },
    )
  })
}

function contentFromThirdpartyResponse(data) {
  if (data && data.error) throw new Error('自定义 AI 返回错误')
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content
  if (!content) throw new Error('自定义 AI 返回空结果')
  return content
}

function contentFromUtoolsResponse(result) {
  const content = result && typeof result === 'object' ? result.content : ''
  if (!content) throw new Error('宿主 AI 返回空结果')
  return content
}

/**
 * 执行一轮 AI 命名。
 *
 * @param {object} params
 * @param {string[]} params.sources 顺序中已有的 AI 来源（ai / thirdparty-ai）
 * @param {object} params.settings 本次快照（含 thirdpartyAiGroups）
 * @param {{role: string, content: string}[]} params.messages 命名消息（system 为固定契约）
 * @param {number} [params.budgetMs] 本轮总预算
 * @param {number} [params.groupTimeoutMs] 自定义 AI 组单次时限（会被剩余预算进一步收紧）
 * @param {object} [params.env]
 * @param {() => boolean} [params.isCurrent] 旧响应失效判定
 * @param {(payload: object) => void} [params.onAttempt] 安全日志回调（不含正文）
 * @returns {Promise<{status: string, words: string[], message?: string, outcomes: object[]}>}
 */
export async function runAiNaming({
  sources,
  settings,
  messages,
  budgetMs = AI_NAMING_TOTAL_BUDGET_MS,
  groupTimeoutMs = 30000,
  env,
  isCurrent,
  onAttempt,
} = {}) {
  const runtime = env || getRuntimeEnv()
  const list = Array.isArray(sources) ? sources.filter(s => AI_NAMING_SOURCES.includes(s)) : []
  const groups = snapshotThirdpartyAiGroups(settings || {})
  const startedAt = Date.now()
  const deadline = startedAt + budgetMs
  const outcomes = []

  const current = () => (typeof isCurrent === 'function' ? !!isCurrent() : true)
  const remaining = () => deadline - Date.now()

  let called = false
  let timedOut = false
  let sawConfiguredSource = false
  let envSkippedOnly = true

  const finish = (status, words, message, extra) => ({
    status,
    words: words || [],
    ...(message ? { message } : {}),
    outcomes,
    ...(extra || {}),
  })

  for (const source of list) {
    if (!current()) return finish(AI_NAMING_STATUS.STALE, [])
    if (remaining() <= 0) {
      timedOut = true
      break
    }

    if (source === 'ai') {
      const utools = runtime && runtime.utools
      if (!utools || typeof utools.ai !== 'function') {
        outcomes.push({ source, status: 'skipped', skipReason: SKIP_REASON.METHOD_MISSING, skipCategory: SKIP_CATEGORY.ENV })
        onAttempt?.({ source, status: 'skipped', category: ERROR_CATEGORY.METHOD_MISSING, phase: 'skip' })
        continue
      }
      sawConfiguredSource = true
      called = true
      const budget = remaining()
      try {
        const result = await raceWithBudget(() => utools.ai({ messages }), budget)
        const parsed = parseNamingResponse(contentFromUtoolsResponse(result))
        if (!current()) return finish(AI_NAMING_STATUS.STALE, [])
        if (!parsed.ok) {
          outcomes.push({ source, status: 'failure', reason: parsed.reason })
          onAttempt?.({ source, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR, phase: 'parse' })
          continue
        }
        outcomes.push({ source, status: 'success' })
        onAttempt?.({ source, status: 'success', phase: 'call' })
        return parsed.shouldName
          ? finish(AI_NAMING_STATUS.READY, parsed.words)
          : finish(AI_NAMING_STATUS.NONE, [])
      } catch (err) {
        if (err && err.timedOut) {
          timedOut = true
          outcomes.push({ source, status: 'failure', category: ERROR_CATEGORY.TIMEOUT })
          onAttempt?.({ source, status: 'failure', category: ERROR_CATEGORY.TIMEOUT, phase: 'call' })
          break
        }
        outcomes.push({ source, status: 'failure', category: ERROR_CATEGORY.UNKNOWN })
        onAttempt?.({ source, status: 'failure', category: ERROR_CATEGORY.UNKNOWN, phase: 'call' })
        continue
      }
    }

    // 自定义 AI：按现有组顺序尝试，每组时限不超过 min(组时限, 剩余总预算)
    for (const group of groups) {
      if (!current()) return finish(AI_NAMING_STATUS.STALE, [])
      if (remaining() <= 0) {
        timedOut = true
        break
      }
      const inspection = inspectThirdpartyAiGroup(group, runtime)
      if (inspection.status === 'skipped') {
        if (inspection.skipCategory !== SKIP_CATEGORY.ENV) envSkippedOnly = false
        outcomes.push({ source, groupId: group && group.id, status: 'skipped', skipReason: inspection.skipReason, skipCategory: inspection.skipCategory })
        onAttempt?.({ source, groupId: group && group.id, status: 'skipped', category: inspection.category, phase: 'skip' })
        continue
      }
      sawConfiguredSource = true
      called = true
      const budget = Math.min(groupTimeoutMs, remaining())
      try {
        // 单次预算 = min(组时限, 剩余总预算)；不使用翻译路径的结果校验与统计结算
        const result = await raceWithBudget(
          () => runtime.services.requestThirdpartyAI(
            group.url,
            group.apiKey,
            { model: group.model, messages, stream: false },
            budget,
          ),
          budget,
        )
        const parsed = parseNamingResponse(contentFromThirdpartyResponse(result))
        if (!current()) return finish(AI_NAMING_STATUS.STALE, [])
        if (!parsed.ok) {
          outcomes.push({ source, groupId: group && group.id, status: 'failure', reason: parsed.reason })
          onAttempt?.({ source, groupId: group && group.id, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR, phase: 'parse' })
          continue
        }
        outcomes.push({ source, groupId: group && group.id, status: 'success' })
        onAttempt?.({ source, groupId: group && group.id, status: 'success', phase: 'call' })
        return parsed.shouldName
          ? finish(AI_NAMING_STATUS.READY, parsed.words)
          : finish(AI_NAMING_STATUS.NONE, [])
      } catch (err) {
        const isTimeout = !!(err && err.timedOut) || /超时|timeout/i.test(String(err && err.message ? err.message : err))
        outcomes.push({ source, groupId: group && group.id, status: 'failure', category: isTimeout ? ERROR_CATEGORY.TIMEOUT : ERROR_CATEGORY.UNKNOWN })
        onAttempt?.({ source, groupId: group && group.id, status: 'failure', category: isTimeout ? ERROR_CATEGORY.TIMEOUT : ERROR_CATEGORY.UNKNOWN, phase: 'call' })
        if (isTimeout && remaining() <= 0) {
          timedOut = true
          break
        }
      }
    }
  }

  if (!current()) return finish(AI_NAMING_STATUS.STALE, [])
  if (timedOut) return finish(AI_NAMING_STATUS.TIMEOUT, [])
  if (!called || !sawConfiguredSource) {
    // 全部因桥接/宿主能力缺失而跳过时，提示重载而非「未配置」
    const message = envSkippedOnly && outcomes.length
      ? AI_NAMING_BRIDGE_MISSING_MESSAGE
      : AI_NAMING_UNCONFIGURED_MESSAGE
    return finish(AI_NAMING_STATUS.UNCONFIGURED, [], message)
  }
  return finish(AI_NAMING_STATUS.FAILED, [])
}

export { AI_NAMING_SYSTEM_CONTRACT }
