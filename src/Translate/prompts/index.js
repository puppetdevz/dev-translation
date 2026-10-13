/**
 * AI 提示词模块索引
 * 统一导出所有 AI 提示词模板
 */

export { buildChineseToEnglishPrompt } from './chineseToEnglish.js'
export { buildEnglishToChinesePrompt } from './englishToChinese.js'
export { buildPolishPrompt, normalizePolishText } from './polish.js'
export { buildLanguageDetectionPrompt, buildLanguageDetectionMessages, normalizeDetectionCode } from './languageDetection.js'
// AI 变量命名使用独立协议与独立契约，不复用翻译提示词
export { AI_NAMING_SYSTEM_CONTRACT, buildAiNamingPrompt, buildAiNamingMessages } from './aiNaming.js'
