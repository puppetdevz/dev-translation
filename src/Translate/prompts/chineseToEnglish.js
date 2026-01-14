/**
 * 中译英提示词模板
 * 用于将中文文本翻译成英文
 */

/**
 * 构建中译英 Prompt
 * @param {string} text - 要翻译的中文文本
 * @returns {string} 完整的 AI 提示词
 */
export const buildChineseToEnglishPrompt = (text) => {
  return `请将以下中文翻译成英文，并以JSON格式返回结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "英文翻译",
  "phonetic": "美式音标(IPA格式)",
  "definitions": ["英文释义1", "英文释义2", "英文释义3"],
  "examples": ["英文例句1", "英文例句2", "英文例句3"]
}

要求:
1. translation: 准确、地道的英文翻译
2. phonetic: 使用国际音标(IPA)，美式发音，格式如 /ˈhɛloʊ/
3. definitions: 提供3-5个英文释义，解释翻译结果的不同含义
4. examples: 提供3-5个英文例句，展示翻译结果的实际用法
5. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
}
