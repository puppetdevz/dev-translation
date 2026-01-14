/**
 * 英译中提示词模板
 * 用于将英文文本翻译成中文
 */

/**
 * 构建英译中 Prompt
 * @param {string} text - 要翻译的英文文本
 * @returns {string} 完整的 AI 提示词
 */
export const buildEnglishToChinesePrompt = (text) => {
  return `请将以下英文翻译成中文，并以JSON格式返回结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "中文翻译",
  "phonetic": "英文原文的美式音标(IPA格式)",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}

要求:
1. translation: 准确、地道的中文翻译
2. phonetic: 原英文的美式音标(IPA格式)，格式如 /ˈhɛloʊ/
3. definitions: 提供3-5个英文释义(保持英文)，解释原文的不同含义
4. examples: 提供3-5个英文例句(保持英文)，展示原文的实际用法
5. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
}
