const fs = require('node:fs')
const path = require('node:path')
const { googletrans } = require('googletrans')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // Google 翻译（Node.js 层调用 googletrans）
  googleTranslate (text, from, to) {
    return new Promise((resolve, reject) => {
      const options = { from, to }
      const timer = setTimeout(() => {
        reject(new Error('Google 翻译超时，请切换至 AI 模式重试'))
      }, 10000)

      googletrans(text, options)
        .then(result => {
          clearTimeout(timer)
          resolve(result.text)
        })
        .catch(err => {
          clearTimeout(timer)
          reject(new Error('Google 翻译失败，请切换至 AI 模式重试: ' + err.message))
        })
    })
  },
  // 词典查询（Free Dictionary API）
  lookupWord (word) {
    return new Promise((resolve) => {
      if (!word || typeof word !== 'string' || !word.trim()) {
        resolve({ phonetic: '', definitions: [], examples: [] })
        return
      }

      const encodedWord = encodeURIComponent(word.trim())
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodedWord}`

      const https = require('https')
      const req = https.get(url, { timeout: 5000 }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (!Array.isArray(parsed) || parsed.length === 0) {
              resolve({ phonetic: '', definitions: [], examples: [] })
              return
            }

            const entry = parsed[0]
            const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics[0]?.text) || ''

            const definitions = []
            const examples = []

            for (const meaning of entry.meanings || []) {
              for (const def of meaning.definitions || []) {
                if (definitions.length < 3) {
                  definitions.push({
                    pos: meaning.partOfSpeech || '',
                    meaning: def.definition || '',
                    example: def.example || '',
                  })
                }
                if (examples.length < 2 && def.example) {
                  examples.push(def.example)
                }
              }
            }

            resolve({ phonetic, definitions, examples })
          } catch {
            resolve({ phonetic: '', definitions: [], examples: [] })
          }
        })
      })

      req.on('error', () => {
        resolve({ phonetic: '', definitions: [], examples: [] })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ phonetic: '', definitions: [], examples: [] })
      })
    })
  },
  // 读文件
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  }
}
