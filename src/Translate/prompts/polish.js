/**
 * 文本润色提示词模板
 * 用于对中英文文本进行润色优化
 */

/**
 * 构建文本润色 Prompt
 * @param {string} text - 要润色的文本
 * @param {string} lang - 文本语言 ('zh' 或 'en')
 * @returns {string} 完整的 AI 提示词
 */
export const buildPolishPrompt = (text, lang) => {
  const langName = lang === 'zh' ? '中文' : '英文'

  return `请对以下${langName}文本进行润色，以易于理解但保留适当专业性的风格重写。

要润色的内容: ${text}

要求:
1. 保持原文的核心含义和专业性
2. 使表达更清晰、流畅、易懂
3. 改善语法和用词的准确性
4. 保持适当的语气（正式/非正式根据原文判断）
5. 仅返回润色后的文本，不要添加任何其他文字或解释
6. 不要使用markdown代码块，直接返回纯文本

直接返回润色后的文本。`
}
