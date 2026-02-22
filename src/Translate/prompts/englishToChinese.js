/**
 * 英译中提示词模板
 * 用于将英文文本翻译成中文
 */

/**
 * 构建英译中单词/词组 Prompt（词典风格）
 * @param {string} text - 要翻译的英文单词或词组
 * @returns {string} 完整的 AI 提示词
 */
export const buildEnglishToChineseWordPrompt = (text) => {
  return `请将以下英文单词或词组翻译成中文，并以JSON格式返回词典风格的结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "中文翻译",
  "phonetic": "英文原文的美式音标(IPA格式)",
  "definitions": [
    {
      "pos": "词性（如 n., v., adj., adv., phr. 等）",
      "meaning": "中文释义",
      "example": "英文例句",
      "exampleTranslation": "例句的中文翻译"
    }
  ],
  "contextNote": "语境说明（简短说明该词/词组的常见用法或语境）"
}

要求:
1. translation: 准确、地道的中文翻译
2. phonetic: 原英文的美式音标(IPA格式)，格式如 /ˈhɛloʊ/
3. definitions: 提供2-4个释义条目，每个条目包含:
   - pos: 词性缩写（名词n., 动词v., 形容词adj., 副词adv., 词组phr.等）
   - meaning: 该词性下的中文释义
   - example: 使用该词/词组的英文例句
   - exampleTranslation: 例句的中文翻译
4. contextNote: 简短的语境说明，帮助理解使用场景
5. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
}

/**
 * 构建英译中句子 Prompt（简洁风格）
 * @param {string} text - 要翻译的英文句子
 * @returns {string} 完整的 AI 提示词
 */
export const buildEnglishToChineseSentencePrompt = (text) => {
  return `请将以下英文句子翻译成中文，并以JSON格式返回结果。

要翻译的内容: ${text}

请严格按照以下JSON格式返回:
{
  "translation": "中文翻译"
}

要求:
1. translation: 准确、地道、流畅的中文翻译
2. 保持原文的语气和风格
3. 必须返回有效的JSON格式，不要添加任何其他文字

直接返回JSON，不要使用markdown代码块。`
}

/**
 * 构建英译中 Prompt（向后兼容，自动判断类型）
 * @param {string} text - 要翻译的英文文本
 * @param {string} type - 输入类型 'word' 或 'sentence'
 * @returns {string} 完整的 AI 提示词
 */
export const buildEnglishToChinesePrompt = (text, type = 'word') => {
  if (type === 'sentence') {
    return buildEnglishToChineseSentencePrompt(text)
  }
  return buildEnglishToChineseWordPrompt(text)
}
