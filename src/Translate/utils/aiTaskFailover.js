/**
 * 辅助 AI 任务（语言检测 / 润色）的共享来源级故障转移。
 *
 * 与主翻译、AI 命名完全隔离：
 * - 不要求 `{ translation }`，由调用方传入任务专用校验函数；
 * - uTools AI 单次受 engineResponseTimeoutSeconds 约束；
 * - 自定义 AI 按组顺序尝试，每组受 thirdpartyAiFailoverTimeoutSeconds 约束，
 *   整条组链不被一级时限截断，也不附带正式翻译的自定义系统提示词；
 * - 首个有效结果立即采用，不并行竞速、不等待全部来源；
 * - 全部耗尽后由调用页面执行一次提示，本模块不弹窗。
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
import { isEngineEnabled } from './engineAvailability.js'

/** 辅助任务允许的来源白名单（固定 AI 类型）。 */
export const AI_TASK_SOURCES = ['ai', 'thirdparty-ai']

const DEFAULT_TIMEOUT_MS = 5000

function resolveTimeoutMs(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return n
}

/** 单次调用与截止时间竞赛，只结算一次；迟到 resolve/reject 被吞掉。 */
function raceWithBudget(run, budgetMs) {
  let settled = false
  const budget = resolveTimeoutMs(budgetMs)
  const call = Promise.resolve().then(run)
  call.catch(() => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const err = new Error('AI 任务请求超时')
      err.timedOut = true
      reject(err)
    }, budget)
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
        reject(err || new Error('AI 任务调用失败'))
      },
    )
  })
}

function utoolsContent(result) {
  return result && typeof result === 'object' ? result.content : ''
}

function thirdpartyContent(data) {
  if (data && data.error) throw new Error('自定义 AI 返回错误')
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content
  if (!content) throw new Error('自定义 AI 返回空结果')
  return content
}

function normalizeValidation(validated) {
  if (validated && validated.ok === true) return { ok: true, value: validated.value }
  return { ok: false }
}

function isTimedOut(err) {
  return !!(err && err.timedOut) || /超时|timeout/i.test(String(err && err.message ? err.message : err))
}

/**
 * 运行一轮辅助 AI 任务。
 *
 * @param {object} params
 * @param {string[]} params.sources 有效 AI 来源顺序（已按开关与优先级过滤）
 * @param {object} params.settings 本次快照（含 engineEnabled / thirdpartyAiGroups / 时限）
 * @param {{role: string, content: string}[]} params.messages 任务消息（不附正式翻译系统提示词）
 * @param {(raw: string) => ({ok: true, value: any} | {ok: false})} params.validate 任务专用校验
 * @param {number} [params.timeoutMs] uTools AI 单次时限（毫秒）
 * @param {number} [params.groupTimeoutMs] 自定义 AI 每组时限（毫秒）
 * @param {object} [params.env]
 * @param {() => boolean} [params.isCurrent] 旧响应失效判定
 * @param {(payload: object) => void} [params.onAttempt] 安全日志回调（不含正文）
 * @returns {Promise<{success: boolean, value?: any, source?: string, groupId?: string, stale?: boolean, outcomes: object[]}>}
 */
export async function runAiTaskFailover({
  sources,
  settings,
  messages,
  validate,
  timeoutMs,
  groupTimeoutMs,
  env,
  isCurrent,
  onAttempt,
} = {}) {
  const runtime = env || getRuntimeEnv()
  const settingsSnap = settings || {}
  const list = (Array.isArray(sources) ? sources : [])
    .filter(source => AI_TASK_SOURCES.includes(source) && isEngineEnabled(settingsSnap, source))
  const groups = snapshotThirdpartyAiGroups(settingsSnap)
  const singleTimeout = resolveTimeoutMs(timeoutMs)
  const groupBudget = resolveTimeoutMs(groupTimeoutMs)
  const validateFn = typeof validate === 'function' ? validate : () => ({ ok: false })
  const outcomes = []

  const current = () => (typeof isCurrent === 'function' ? !!isCurrent() : true)

  const accept = (raw, source, groupId) => {
    const validated = normalizeValidation(validateFn(raw))
    return { validated, source, groupId }
  }

  for (const source of list) {
    if (!current()) return { stale: true, success: false, outcomes }

    if (source === 'ai') {
      const utools = runtime && runtime.utools
      if (!utools || typeof utools.ai !== 'function') {
        outcomes.push({ source, status: 'skipped', skipReason: SKIP_REASON.METHOD_MISSING, skipCategory: SKIP_CATEGORY.ENV })
        onAttempt?.({ source, status: 'skipped', category: ERROR_CATEGORY.METHOD_MISSING, phase: 'skip' })
        continue
      }
      try {
        const result = await raceWithBudget(() => utools.ai({ messages }), singleTimeout)
        if (!current()) return { stale: true, success: false, outcomes }
        const { validated } = accept(utoolsContent(result), source)
        if (validated.ok) {
          outcomes.push({ source, status: 'success' })
          onAttempt?.({ source, status: 'success', phase: 'call' })
          return { success: true, value: validated.value, source, outcomes }
        }
        outcomes.push({ source, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR })
        onAttempt?.({ source, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR, phase: 'parse' })
      } catch (err) {
        if (!current()) return { stale: true, success: false, outcomes }
        const category = isTimedOut(err) ? ERROR_CATEGORY.TIMEOUT : ERROR_CATEGORY.UNKNOWN
        outcomes.push({ source, status: 'failure', category })
        onAttempt?.({ source, status: 'failure', category, phase: 'call' })
      }
      continue
    }

    // 自定义 AI：按组顺序尝试，每组独立时限；整条组链不被一级时限截断。
    for (const group of groups) {
      if (!current()) return { stale: true, success: false, outcomes }
      const inspection = inspectThirdpartyAiGroup(group, runtime)
      if (inspection.status === 'skipped') {
        outcomes.push({
          source,
          groupId: group && group.id,
          status: 'skipped',
          skipReason: inspection.skipReason,
          skipCategory: inspection.skipCategory,
        })
        onAttempt?.({ source, groupId: group && group.id, status: 'skipped', category: inspection.category, phase: 'skip' })
        continue
      }
      try {
        const data = await raceWithBudget(
          () => runtime.services.requestThirdpartyAI(
            group.url,
            group.apiKey,
            { model: group.model, messages, stream: false },
            groupBudget,
          ),
          groupBudget,
        )
        if (!current()) return { stale: true, success: false, outcomes }
        const { validated } = accept(thirdpartyContent(data), source, group && group.id)
        if (validated.ok) {
          outcomes.push({ source, groupId: group && group.id, status: 'success' })
          onAttempt?.({ source, groupId: group && group.id, status: 'success', phase: 'call' })
          return { success: true, value: validated.value, source, groupId: group && group.id, outcomes }
        }
        outcomes.push({ source, groupId: group && group.id, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR })
        onAttempt?.({ source, groupId: group && group.id, status: 'failure', category: ERROR_CATEGORY.PARSE_ERROR, phase: 'parse' })
      } catch (err) {
        if (!current()) return { stale: true, success: false, outcomes }
        const category = isTimedOut(err) ? ERROR_CATEGORY.TIMEOUT : ERROR_CATEGORY.UNKNOWN
        outcomes.push({ source, groupId: group && group.id, status: 'failure', category })
        onAttempt?.({ source, groupId: group && group.id, status: 'failure', category, phase: 'call' })
      }
    }
  }

  if (!current()) return { stale: true, success: false, outcomes }
  return { success: false, outcomes }
}
