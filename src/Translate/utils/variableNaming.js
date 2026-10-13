/**
 * 变量命名纯函数：词元提取与 5 种命名格式。
 *
 * - 常规命名沿用原有规则：从英文文本用正则提取词元（句子末尾标点不会进入标识符）。
 * - AI 命名直接接收结构化英文词元，不再把 `discoveryCount` 之类字符串重新解析成词元，
 *   避免词界丢失（不会被降成 discoverycount）。
 */

export const NAMING_FORMATS = ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE', 'kebab-case']

/** 从任意文本提取英文词元（小写）。保持常规命名的原有行为。 */
export function extractEnglishTokens(text) {
  return (String(text == null ? '' : text).match(/[A-Za-z][A-Za-z0-9]*/g) || []).map(w => w.toLowerCase())
}

/** 单个英文词元是否可用于命名。 */
export function isValidNamingWord(word) {
  return typeof word === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(word)
}

/**
 * 同一组英文词元 → 5 种命名格式。
 * @param {string[]} words
 * @returns {{label: string, value: string}[]}
 */
export function formatVariableNames(words) {
  const list = (Array.isArray(words) ? words : [])
    .map(w => String(w || '').trim().toLowerCase())
    .filter(isValidNamingWord)
  if (!list.length) return []
  const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  return [
    { label: 'camelCase', value: list[0] + list.slice(1).map(capitalize).join('') },
    { label: 'PascalCase', value: list.map(capitalize).join('') },
    { label: 'snake_case', value: list.join('_') },
    { label: 'UPPER_CASE', value: list.join('_').toUpperCase() },
    { label: 'kebab-case', value: list.join('-') },
  ]
}

/** 常规命名：从英文文本提取词元后生成命名格式。 */
export function buildRegularVariableNames(englishText) {
  return formatVariableNames(extractEnglishTokens(englishText))
}
