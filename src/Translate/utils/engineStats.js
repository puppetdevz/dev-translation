/**
 * 翻译引擎稳定性统计模块
 *
 * 用途：记录每个翻译引擎的翻译成功/失败次数，计算成功率，供设置页"高级 → 稳定性统计"展示，
 * 帮助用户判断各引擎稳定性，并据此优化故障转移顺序。
 *
 * 与 logger.js 的区别：日志受 logLevel 过滤（默认仅记录 error，成功不会入库），
 * 统计模块始终记录每一次结果，且仅保留计数与最近窗口，不存详细消息，体积小。
 *
 * 存储结构（dbStorage 直接存对象，与 logger 存数组一致）：
 * {
 *   ai:            { total, success, failure, recent: [0|1...], lastTime, lastSuccess, lastFailure },
 *   'thirdparty-ai': {...},
 *   google: {...}, deepl: {...}, deeplx: {...}
 * }
 * - recent: 最近 RECENT_WINDOW 次结果的滚动窗口（1=成功, 0=失败），用于计算"近期成功率"
 *   近期成功率比总体成功率更能反映引擎当前可用性，适合作为排序与展示的主要指标
 */

const STATS_STORAGE_KEY = 'dev-translation-engine-stats'
const RECENT_WINDOW = 50
// 近期成功率至少需要的样本数，不足时回退到总体成功率，避免少量样本波动误导判断
const RECENT_MIN_SAMPLES = 5

function emptyStat() {
  return { total: 0, success: 0, failure: 0, recent: [], lastTime: 0, lastSuccess: 0, lastFailure: 0 }
}

/** 读取全部引擎统计（容错：兼容旧版/异常数据） */
function readStats() {
  try {
    const raw = window.utools.dbStorage.getItem(STATS_STORAGE_KEY)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
    if (typeof raw === 'string' && raw) {
      const p = JSON.parse(raw)
      return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {}
    }
  } catch (e) {
    // 静默
  }
  return {}
}

/** 写入全部引擎统计 */
function writeStats(stats) {
  try {
    window.utools.dbStorage.setItem(STATS_STORAGE_KEY, stats)
  } catch (e) {
    // 静默
  }
}

/**
 * 记录一次引擎翻译结果（成功或失败）
 * 在 index.vue 的 translate() 故障转移循环中，每个引擎尝试成功/失败时调用
 * @param {string} engine - 引擎标识（'ai' | 'thirdparty-ai' | 'google' | 'deepl' | 'deeplx'）
 * @param {boolean} success - 是否成功
 */
export function recordEngineResult(engine, success) {
  if (!engine) return
  const stats = readStats()
  const s = stats[engine] || emptyStat()
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
  // 滚动窗口：仅保留最近 RECENT_WINDOW 次
  if (s.recent.length > RECENT_WINDOW) {
    s.recent = s.recent.slice(s.recent.length - RECENT_WINDOW)
  }
  stats[engine] = s
  writeStats(stats)
}

/** 获取全部引擎原始统计对象（{ engineId: stat }） */
export function getEngineStats() {
  return readStats()
}

/** 获取单个引擎原始统计 */
export function getEngineStat(engine) {
  return readStats()[engine] || emptyStat()
}

/** 清空全部引擎统计 */
export function clearEngineStats() {
  try {
    window.utools.dbStorage.setItem(STATS_STORAGE_KEY, {})
  } catch (e) {
    // 静默
  }
}

/** 清空单个引擎统计 */
export function clearEngineStat(engine) {
  if (!engine) return
  const stats = readStats()
  if (stats[engine]) {
    delete stats[engine]
    writeStats(stats)
  }
}

/**
 * 计算单个引擎的稳定性指标
 * @param {object} stat - 原始统计对象
 * @returns {object} 指标对象
 *   - total/success/failure: 计数
 *   - overallRate: 总体成功率（0~1，无数据为 null）
 *   - recentRate: 近期成功率（0~1，无近期样本为 null）
 *   - recentSamples: 近期样本数
 *   - rate: 用于排序与主展示的成功率（近期样本足够用 recentRate，否则 overallRate，无数据为 null）
 *   - hasData: 是否有翻译记录
 *   - lastTime/lastSuccess/lastFailure: 最近时间戳
 */
export function computeStability(stat) {
  const s = stat || emptyStat()
  const total = s.total || 0
  const success = s.success || 0
  const failure = s.failure || 0
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

// 导出常量供 UI 展示
export const ENGINE_STATS_RECENT_WINDOW = RECENT_WINDOW
export const ENGINE_STATS_RECENT_MIN_SAMPLES = RECENT_MIN_SAMPLES
