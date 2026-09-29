/**
 * 翻译引擎稳定性统计模块
 *
 * 用途：记录每个翻译引擎的翻译成功/失败/跳过次数，计算成功率，供设置页"高级 → 稳定性统计"展示，
 * 帮助用户判断各引擎稳定性，并据此优化故障转移顺序。
 *
 * 成功率、近期窗口和“按稳定性排序”只以实际调用成功/失败为分母，跳过不计入 total/recent。
 *
 * 存储结构（dbStorage 直接存对象，与 logger 存数组一致）：
 * {
 *   ai: { total, success, failure, skipped, skipEnv, skipConfig, recent: [0|1...], lastTime, lastSuccess, lastFailure },
 *   ...
 * }
 * - recent: 最近 RECENT_WINDOW 次**实际调用**结果的滚动窗口（1=成功, 0=失败）
 * - skipped / skipEnv / skipConfig: 独立计数，读取旧数据时缺省为 0
 */

const STATS_STORAGE_KEY = 'dev-translation-engine-stats'
const RECENT_WINDOW = 50
const RECENT_MIN_SAMPLES = 5

function emptyStat() {
  return {
    total: 0,
    success: 0,
    failure: 0,
    skipped: 0,
    skipEnv: 0,
    skipConfig: 0,
    recent: [],
    lastTime: 0,
    lastSuccess: 0,
    lastFailure: 0,
  }
}

function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 旧对象字段默认值向后兼容：缺省跳过数为 0，保留原成功/失败和顺序 */
export function normalizeEngineStat(raw) {
  const s = emptyStat()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s
  s.total = toCount(raw.total)
  s.success = toCount(raw.success)
  s.failure = toCount(raw.failure)
  s.skipped = toCount(raw.skipped)
  s.skipEnv = toCount(raw.skipEnv)
  s.skipConfig = toCount(raw.skipConfig)
  s.recent = Array.isArray(raw.recent) ? raw.recent.filter(v => v === 0 || v === 1) : []
  s.lastTime = toCount(raw.lastTime)
  s.lastSuccess = toCount(raw.lastSuccess)
  s.lastFailure = toCount(raw.lastFailure)
  return s
}

function readStats() {
  try {
    const raw = window.utools.dbStorage.getItem(STATS_STORAGE_KEY)
    let parsed = raw
    if (typeof raw === 'string' && raw) {
      parsed = JSON.parse(raw)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [engine, stat] of Object.entries(parsed)) {
      out[engine] = normalizeEngineStat(stat)
    }
    return out
  } catch (e) {
    // 静默
  }
  return {}
}

function writeStats(stats) {
  try {
    window.utools.dbStorage.setItem(STATS_STORAGE_KEY, stats)
  } catch (e) {
    // 静默
  }
}

/**
 * 记录一次引擎翻译结果（成功或失败）。仅在真实发起请求后调用。
 * @param {string} engine - 引擎标识
 * @param {boolean} success - 是否成功
 */
export function recordEngineResult(engine, success) {
  if (!engine) return
  const stats = readStats()
  const s = normalizeEngineStat(stats[engine])
  s.total += 1
  if (success) {
    s.success += 1
    s.lastSuccess = Date.now()
  } else {
    s.failure += 1
    s.lastFailure = Date.now()
  }
  s.lastTime = Date.now()
  s.recent.push(success ? 1 : 0)
  if (s.recent.length > RECENT_WINDOW) {
    s.recent = s.recent.slice(s.recent.length - RECENT_WINDOW)
  }
  stats[engine] = s
  writeStats(stats)
}

/**
 * 记录一次跳过（未发真实网络请求）。不计入 total / recent / 成功率。
 * @param {string} engine
 * @param {'env'|'config'} category
 */
export function recordEngineSkip(engine, category) {
  if (!engine) return
  const stats = readStats()
  const s = normalizeEngineStat(stats[engine])
  s.skipped += 1
  if (category === 'config') s.skipConfig += 1
  else s.skipEnv += 1
  s.lastTime = Date.now()
  stats[engine] = s
  writeStats(stats)
}

export function getEngineStats() {
  return readStats()
}

export function getEngineStat(engine) {
  return normalizeEngineStat(readStats()[engine])
}

export function clearEngineStats() {
  try {
    window.utools.dbStorage.setItem(STATS_STORAGE_KEY, {})
  } catch (e) {
    // 静默
  }
}

export function clearEngineStat(engine) {
  if (!engine) return
  const stats = readStats()
  if (stats[engine]) {
    delete stats[engine]
    writeStats(stats)
  }
}

/**
 * 计算单个引擎的稳定性指标。total = success + failure，跳过独立。
 */
export function computeStability(stat) {
  const s = normalizeEngineStat(stat)
  const total = s.total || 0
  const success = s.success || 0
  const failure = s.failure || 0
  const skipped = s.skipped || 0
  const recent = Array.isArray(s.recent) ? s.recent : []
  const recentSamples = recent.length
  const overallRate = total > 0 ? success / total : null
  const recentSum = recent.reduce((a, b) => a + b, 0)
  const recentRate = recentSamples > 0 ? recentSum / recentSamples : null
  const rate = recentSamples >= RECENT_MIN_SAMPLES
    ? recentRate
    : (total > 0 ? overallRate : null)
  return {
    total,
    success,
    failure,
    skipped,
    skipEnv: s.skipEnv || 0,
    skipConfig: s.skipConfig || 0,
    overallRate,
    recentRate,
    recentSamples,
    rate,
    hasData: total > 0,
    lastTime: s.lastTime || 0,
    lastSuccess: s.lastSuccess || 0,
    lastFailure: s.lastFailure || 0,
  }
}

export const ENGINE_STATS_RECENT_WINDOW = RECENT_WINDOW
export const ENGINE_STATS_RECENT_MIN_SAMPLES = RECENT_MIN_SAMPLES
