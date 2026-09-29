/**
 * 自定义 AI 多组配置：规范化、预检与二级故障转移。
 * 不依赖 Vue；window / 服务通过参数注入，便于隔离测试。
 */

import {
  attemptEngineCall,
  classifyError,
  getRuntimeEnv,
  SKIP_REASON,
  SKIP_CATEGORY,
  ERROR_CATEGORY,
  SAFE_MESSAGES,
  PRELOAD_METHODS,
} from './engineBridge.js'

export const DEFAULT_GROUP_ID = 'g_default'
export const MIGRATED_GROUP_ID = 'g_migrated'
export const DEFAULT_GROUP_NAME = '自定义 AI 1'

const GROUP_ID_RE = /^g_[a-z0-9_]+$/i

export function isBlank(value) {
  return !value || !String(value).trim()
}

export function createGroupId(existingIds = []) {
  const used = new Set((existingIds || []).filter(Boolean))
  for (let i = 0; i < 8; i++) {
    const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    if (!used.has(id)) return id
  }
  return `g_${Date.now().toString(36)}_${used.size}`
}

export function generateUniqueGroupName(existingNames = []) {
  const used = new Set((existingNames || []).map(n => String(n || '').trim()).filter(Boolean))
  let n = 1
  while (used.has(`自定义 AI ${n}`)) n += 1
  return `自定义 AI ${n}`
}

export function createEmptyGroup(existingNames = [], existingIds = []) {
  return {
    id: createGroupId(existingIds),
    name: generateUniqueGroupName(existingNames),
    url: '',
    apiKey: '',
    model: '',
  }
}

export function defaultThirdpartyAiGroups() {
  return [{
    id: DEFAULT_GROUP_ID,
    name: DEFAULT_GROUP_NAME,
    url: '',
    apiKey: '',
    model: '',
  }]
}

export function cloneGroups(groups) {
  if (!Array.isArray(groups)) return []
  return groups.map(g => ({
    id: String(g.id || ''),
    name: String(g.name || ''),
    url: String(g.url || ''),
    apiKey: String(g.apiKey || ''),
    model: String(g.model || ''),
  }))
}

function sanitizeGroupId(raw, existingIds) {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (GROUP_ID_RE.test(id) && !existingIds.has(id)) return id
  return createGroupId([...existingIds])
}

function sanitizeGroupName(raw, existingNames) {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name && !existingNames.has(name)) return name
  if (name && existingNames.has(name)) {
    let n = 2
    let candidate = `${name} (${n})`
    while (existingNames.has(candidate)) {
      n += 1
      candidate = `${name} (${n})`
    }
    return candidate
  }
  return generateUniqueGroupName([...existingNames])
}

/**
 * 校验并规范化组列表：去重 ID/名称，补齐字段。空数组保持为空。
 */
export function normalizeThirdpartyAiGroups(raw) {
  if (!Array.isArray(raw)) return defaultThirdpartyAiGroups()
  const ids = new Set()
  const names = new Set()
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = sanitizeGroupId(item.id, ids)
    const name = sanitizeGroupName(item.name, names)
    ids.add(id)
    names.add(name)
    out.push({
      id,
      name,
      url: item.url == null ? '' : String(item.url),
      apiKey: item.apiKey == null ? '' : String(item.apiKey),
      model: item.model == null ? '' : String(item.model),
    })
  }
  return out
}

export function migrateLegacyThirdpartyAiGroup(parsed = {}) {
  return [{
    id: MIGRATED_GROUP_ID,
    name: DEFAULT_GROUP_NAME,
    url: parsed.thirdpartyAiUrl == null ? '' : String(parsed.thirdpartyAiUrl),
    apiKey: parsed.thirdpartyAiKey == null ? '' : String(parsed.thirdpartyAiKey),
    model: parsed.thirdpartyAiModel == null ? '' : String(parsed.thirdpartyAiModel),
  }]
}

/**
 * 解析运行时组列表：已有数组（含空数组）优先；否则从旧单套字段合成一组。
 */
export function resolveThirdpartyAiGroups(settings = {}) {
  if (Array.isArray(settings.thirdpartyAiGroups)) {
    return cloneGroups(normalizeThirdpartyAiGroups(settings.thirdpartyAiGroups))
  }
  const hasLegacy = !isBlank(settings.thirdpartyAiUrl)
    || !isBlank(settings.thirdpartyAiKey)
    || !isBlank(settings.thirdpartyAiModel)
  if (hasLegacy) return migrateLegacyThirdpartyAiGroup(settings)
  return []
}

export function snapshotThirdpartyAiGroups(settings = {}) {
  return resolveThirdpartyAiGroups(settings)
}

export function inspectThirdpartyAiGroup(group, env = getRuntimeEnv()) {
  const services = env && env.services
  const method = PRELOAD_METHODS['thirdparty-ai']
  if (!services) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.BRIDGE_MISSING,
      skipCategory: SKIP_CATEGORY.ENV,
      category: ERROR_CATEGORY.BRIDGE_MISSING,
      safeMessage: SAFE_MESSAGES.BRIDGE_MISSING,
    }
  }
  if (!method || typeof services[method] !== 'function') {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.METHOD_MISSING,
      skipCategory: SKIP_CATEGORY.ENV,
      category: ERROR_CATEGORY.METHOD_MISSING,
      safeMessage: SAFE_MESSAGES.METHOD_MISSING,
    }
  }
  if (!group || isBlank(group.url) || isBlank(group.apiKey) || isBlank(group.model)) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASON.NOT_CONFIGURED,
      skipCategory: SKIP_CATEGORY.CONFIG,
      category: ERROR_CATEGORY.NOT_CONFIGURED,
      safeMessage: SAFE_MESSAGES.NOT_CONFIGURED,
    }
  }
  return { status: 'ready' }
}

export function hasReadyThirdpartyAiGroup(settings = {}, env = getRuntimeEnv()) {
  const groups = resolveThirdpartyAiGroups(settings)
  return groups.some(group => inspectThirdpartyAiGroup(group, env).status === 'ready')
}

function resolveGroupTimeoutMs(timeoutMs) {
  const n = Number(timeoutMs)
  if (!Number.isFinite(n) || n <= 0) return 5000
  return n
}

/**
 * 按组顺序串行尝试。缺字段跳过不发请求；真实失败/超时/524 立即下一组。
 * 每组使用完整的二级时限，没有组链总上限。迟到结果由 attemptEngineCall 隔离。
 */
export async function runThirdpartyAiGroupFailover({
  groups,
  timeoutMs,
  env,
  requestGroup,
  isCurrent,
  onGroupSkip,
  onGroupFailure,
  onGroupSuccess,
} = {}) {
  const list = Array.isArray(groups) ? groups : []
  const outcomes = []
  const runtime = env || getRuntimeEnv()
  const budget = resolveGroupTimeoutMs(timeoutMs)
  let called = false

  for (let i = 0; i < list.length; i++) {
    if (typeof isCurrent === 'function' && !isCurrent()) {
      return { stale: true, success: false, allSkipped: !called, outcomes }
    }
    const group = list[i]
    const inspection = inspectThirdpartyAiGroup(group, runtime)
    if (inspection.status === 'skipped') {
      outcomes.push({
        groupId: group && group.id,
        groupIndex: i,
        status: 'skipped',
        skipReason: inspection.skipReason,
        skipCategory: inspection.skipCategory,
        category: inspection.category,
        safeMessage: inspection.safeMessage,
      })
      onGroupSkip?.(group, inspection, i)
      continue
    }

    called = true
    try {
      const result = await attemptEngineCall(
        () => requestGroup(group, budget),
        group && group.id,
        budget,
      )
      if (typeof isCurrent === 'function' && !isCurrent()) {
        return { stale: true, success: false, allSkipped: false, outcomes }
      }
      outcomes.push({
        groupId: group && group.id,
        groupIndex: i,
        status: 'success',
      })
      onGroupSuccess?.(group, result, i)
      return {
        stale: false,
        success: true,
        allSkipped: false,
        result,
        groupId: group && group.id,
        groupIndex: i,
        outcomes,
      }
    } catch (err) {
      if (typeof isCurrent === 'function' && !isCurrent()) {
        return { stale: true, success: false, allSkipped: false, outcomes }
      }
      const classified = classifyError(err)
      outcomes.push({
        groupId: group && group.id,
        groupIndex: i,
        status: 'failure',
        category: classified.category,
        statusCode: classified.statusCode,
        safeMessage: classified.safeMessage,
      })
      onGroupFailure?.(group, classified, i)
    }
  }

  const allSkipped = !called
  return {
    stale: false,
    success: false,
    allSkipped,
    outcomes,
    message: allSkipped
      ? (list.length === 0
        ? '没有已配置的自定义 AI 组。请在设置中添加组并填写 API 链接、Key 和模型。'
        : '没有已配置的自定义 AI 组。请在设置中填写 API 链接、Key 和模型。')
      : '自定义 AI 各组均调用失败',
  }
}

export function createGroupRequest({ messages, env, includeSystemPrompt = false, systemPrompt = '' } = {}) {
  const runtime = env || getRuntimeEnv()
  const payloadMessages = []
  if (includeSystemPrompt && systemPrompt && String(systemPrompt).trim()) {
    payloadMessages.push({ role: 'system', content: String(systemPrompt) })
  }
  const userMessages = Array.isArray(messages) ? messages : []
  payloadMessages.push(...userMessages)

  return async function requestGroup(group, timeoutMs) {
    const services = runtime && runtime.services
    if (!services || typeof services.requestThirdpartyAI !== 'function') {
      throw new Error('翻译服务方法不可用')
    }
    const data = await services.requestThirdpartyAI(
      group.url,
      group.apiKey,
      {
        model: group.model,
        messages: payloadMessages,
        stream: false,
      },
      timeoutMs,
    )
    if (data && data.error) throw new Error('自定义 AI 返回错误')
    const content = (data && data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content) || ''
    const translation = String(content).trim()
    if (!translation) throw new Error('自定义 AI 返回空结果')
    return { translation, rawContent: content }
  }
}

export function stripLegacyThirdpartyAiFields(settings) {
  if (!settings || typeof settings !== 'object') return settings
  delete settings.thirdpartyAiUrl
  delete settings.thirdpartyAiKey
  delete settings.thirdpartyAiModel
  return settings
}

export function isSafeGroupId(value) {
  return typeof value === 'string' && GROUP_ID_RE.test(value)
}
