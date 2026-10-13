/**
 * 引擎启停、固定类型与有效顺序的共享纯逻辑。
 *
 * 只承载「用户开关」这一层准入判断，不判断配置/桥接是否可用：
 * - 自动路径（主翻译、检测、润色、命名、批量测试）先按本模块过滤关闭项；
 * - 手动维护（单引擎测试、单组测试、获取模型）保留例外，不经过启停过滤。
 */

/** 已知八类引擎白名单，与持久化顺序、设置页渲染保持一致。 */
export const KNOWN_ENGINES = ['ai', 'thirdparty-ai', 'google', 'deepl', 'deeplx', 'baidu', 'aliyun', 'caiyun']

/** 固定类型：分类由系统决定，不允许用户修改。 */
export const ENGINE_KIND = {
  ai: 'ai',
  'thirdparty-ai': 'ai',
  google: 'mt',
  deepl: 'mt',
  deeplx: 'mt',
  baidu: 'mt',
  aliyun: 'mt',
  caiyun: 'mt',
}

export const ENGINE_KIND_LABEL = {
  ai: 'AI',
  mt: 'MT',
}

export const ENGINE_ENABLED_STORAGE_KEY = 'engineEnabled'

export function engineKind(engine) {
  return ENGINE_KIND[engine] || ''
}

export function engineKindLabel(engine) {
  return ENGINE_KIND_LABEL[engineKind(engine)] || ''
}

/** 默认八项全部开启。每次调用返回新对象，避免多个实例共享同一可变映射。 */
export function defaultEngineEnabled() {
  const out = {}
  for (const engine of KNOWN_ENGINES) out[engine] = true
  return out
}

/**
 * 规范化启停映射：
 * - 仅认可真实布尔值；
 * - 缺键、null、字符串等非法值统一按 true（升级不因未配置或字段缺失而自动关闭）；
 * - 显式 false 原样保留；
 * - 未知键忽略。
 */
export function normalizeEngineEnabled(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const engine of KNOWN_ENGINES) {
    const value = source[engine]
    out[engine] = typeof value === 'boolean' ? value : true
  }
  return out
}

/** 深复制（同时规范化），避免响应式实例与持久化快照共享可变映射。 */
export function cloneEngineEnabled(raw) {
  return normalizeEngineEnabled(raw)
}

/** 单个引擎是否开启；映射缺失或值非法时按开启处理。 */
export function isEngineEnabled(settings, engine) {
  if (!KNOWN_ENGINES.includes(engine)) return true
  const map = settings && settings.engineEnabled
  if (!map || typeof map !== 'object' || Array.isArray(map)) return true
  const value = map[engine]
  return typeof value === 'boolean' ? value : true
}

/** 返回一个新映射，只改变目标引擎；其他键保持规范化结果。 */
export function setEngineEnabled(raw, engine, enabled) {
  const next = normalizeEngineEnabled(raw)
  if (KNOWN_ENGINES.includes(engine)) next[engine] = enabled === true
  return next
}

/** 是否八项全部关闭。 */
export function isAllEnginesDisabled(settings) {
  return KNOWN_ENGINES.every(engine => !isEngineEnabled(settings, engine))
}

function dedupeKnownOrder(order) {
  const seen = new Set()
  const out = []
  if (!Array.isArray(order)) return out
  for (const engine of order) {
    if (KNOWN_ENGINES.includes(engine) && !seen.has(engine)) {
      seen.add(engine)
      out.push(engine)
    }
  }
  return out
}

/** 有效顺序：白名单规范化后的保存顺序过滤关闭项，不原地改写原数组。 */
export function getEnabledEngineOrder(settings) {
  const order = dedupeKnownOrder(settings && settings.failoverOrder)
  return order.filter(engine => isEngineEnabled(settings, engine))
}

/** 有效主引擎：首个开启项；全部关闭时为 null（禁止用 || 'ai' 掩盖合法全关）。 */
export function getPrimaryEnabledEngine(settings) {
  const order = getEnabledEngineOrder(settings)
  return order.length ? order[0] : null
}

/** 有效 AI 来源：在有效顺序上按固定类型筛选，保持相对次序。 */
export function getEnabledAiSources(settings) {
  return getEnabledEngineOrder(settings).filter(engine => engineKind(engine) === 'ai')
}

/**
 * 排序结果合成：开启项按给定排序结果在前，关闭项按排序前的相对顺序接在末尾。
 * 输出覆盖全部已知引擎，不重复、不漏项；不改变任何开关。
 */
export function composeOrderWithDisabled(orderedEnabled, settings) {
  const enabledSet = new Set(getEnabledEngineOrder(settings))
  const head = dedupeKnownOrder(orderedEnabled).filter(engine => enabledSet.has(engine))
  const seenHead = new Set(head)
  // 未出现在排序结果中的开启项，按原相对顺序接在开启区末尾（保证不丢项）
  for (const engine of dedupeKnownOrder(settings && settings.failoverOrder)) {
    if (enabledSet.has(engine) && !seenHead.has(engine)) {
      seenHead.add(engine)
      head.push(engine)
    }
  }
  const disabled = []
  const seen = new Set()
  for (const engine of dedupeKnownOrder(settings && settings.failoverOrder)) {
    if (seen.has(engine)) continue
    seen.add(engine)
    if (!enabledSet.has(engine)) disabled.push(engine)
  }
  for (const engine of KNOWN_ENGINES) {
    if (seen.has(engine) || enabledSet.has(engine)) continue
    seen.add(engine)
    disabled.push(engine)
  }
  return [...head, ...disabled]
}

/**
 * 翻译页快捷轮换：只轮换开启项，抽出开启项轮转后填回原开启项位置。
 * 关闭项保持原位置与相对次序，不因轮换被启用。
 * @returns {{order: string[], changed: boolean}}
 */
export function rotateEnabledOrder(settings) {
  const original = dedupeKnownOrder(settings && settings.failoverOrder)
  const positions = []
  const enabled = []
  original.forEach((engine, index) => {
    if (isEngineEnabled(settings, engine)) {
      positions.push(index)
      enabled.push(engine)
    }
  })
  if (enabled.length <= 1) return { order: original, changed: false }
  const rotated = [...enabled.slice(1), enabled[0]]
  const next = [...original]
  positions.forEach((position, i) => { next[position] = rotated[i] })
  return { order: next, changed: true }
}

/**
 * 持久化顺序补全：保留当前列表中的合法项与相对顺序，缺失项按白名单顺序追加。
 * 不因有效顺序而覆盖持久化的完整列表（关闭项必须留在列表里可重新开启）。
 */
export function ensureFullKnownOrder(order) {
  const next = dedupeKnownOrder(order)
  const seen = new Set(next)
  for (const engine of KNOWN_ENGINES) {
    if (!seen.has(engine)) {
      seen.add(engine)
      next.push(engine)
    }
  }
  return next
}
