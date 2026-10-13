import fs from 'node:fs'
import path from 'node:path'

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i

function findPackageRoot(moduleId) {
  if (moduleId.startsWith('\0')) return null
  const filename = moduleId.split('?')[0]
  if (!path.isAbsolute(filename) || !filename.split(path.sep).includes('node_modules')) return null
  let dir = path.dirname(filename)
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('打包的第三方模块缺少 package.json，无法保留许可')
}

function readPackageNotice(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (!pkg.name || !pkg.version || typeof pkg.license !== 'string') {
    throw new Error(`${pkg.name || '第三方包'} 缺少许可元数据`)
  }
  const files = fs.readdirSync(dir).filter(name => LICENSE_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort()
  if (!files.some(name => /^(?:licen[cs]e|copying)(?:$|[._-])/i.test(name))) {
    throw new Error(`${pkg.name} 缺少许可文本，不能分发`)
  }
  return {
    id: `${pkg.name}@${pkg.version}`,
    text: `${pkg.name}@${pkg.version}\nLicense: ${pkg.license}\n\n` + files.map(name => (
      `--- ${name} ---\n${fs.readFileSync(path.join(dir, name), 'utf8')}\n`
    )).join('\n'),
  }
}

/**
 * 本地词库（非代码数据）许可：数据文件直接随 public → dist 打包，
 * 不会被 node_modules 扫描覆盖，因此必须显式接入，缺许可文本时阻止构建。
 * 返回 null 表示当前项目没有打包词库（例如隔离测试环境）。
 */
function readDictionaryLicenses(rootDir) {
  const dictDir = path.join(rootDir, 'public', 'preload', 'dictionary')
  const manifestFile = path.join(dictDir, 'manifest.json')
  if (!fs.existsSync(manifestFile)) return null
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  const sources = Array.isArray(manifest.sources) ? manifest.sources : []
  const blocks = []
  const missing = []
  for (const source of sources) {
    if (!source || !source.licenseFile) {
      missing.push(source && source.id ? source.id : '未知数据源')
      continue
    }
    const file = path.join(dictDir, source.licenseFile)
    if (!fs.existsSync(file)) {
      missing.push(`${source.id || '未知数据源'}（缺少 ${source.licenseFile}）`)
      continue
    }
    blocks.push([
      `${source.name || source.id}`,
      `License: ${source.license || '未声明'}`,
      `Source: ${source.url || ''}`,
      source.repo ? `Repository: ${source.repo}` : '',
      source.region ? `Region: ${source.region}${source.regionEvidence ? `（${source.regionEvidence}）` : ''}` : '',
      source.usage ? `Usage: ${source.usage}` : '',
      '',
      fs.readFileSync(file, 'utf8'),
    ].filter(Boolean).join('\n'))
  }
  if (missing.length) {
    throw new Error(`本地词库数据源缺少许可文本，不能分发：${missing.join('、')}`)
  }
  if (!sources.length) {
    throw new Error('本地词库存在但未声明数据来源与许可，不能分发')
  }
  const counts = manifest.counts || {}
  const header = [
    '本地词库第三方数据许可与署名',
    '',
    `词库版本：${manifest.version || '未知'}`,
    `条目：单词 ${counts.words || 0}、固定词组 ${counts.phrases || 0}`,
    '运行数据只包含筛选后的词条字段；原始下载数据的 URL、日期与 SHA-256 见 preload/dictionary/SOURCES.json。',
    '',
    '说明：仓库代码许可为 GPL-3.0-only，不改变第三方数据自身的许可；',
    '由 Wiktionary 衍生的词库内容继续以 CC BY-SA 4.0 相同方式共享，Open English WordNet 释义以 CC BY 4.0 署名使用。',
    '',
    '====================',
    '',
  ].join('\n')
  return header + blocks.join('\n====================\n\n') + '\n'
}

// 仅汇总实际输出 chunk 的依赖，另加以原始文件分发的 preload 运行时依赖。
// 原始许可/NOTICE 原文保留，输出不包含开发机路径；更新依赖后随构建重新生成。
export function buildLicenseAssets(moduleIds, rootDir) {
  const dirs = new Set([path.join(rootDir, 'node_modules', 'google-translate-api-x')])
  for (const id of moduleIds) {
    const dir = findPackageRoot(id)
    if (dir) dirs.add(dir)
  }
  const packages = Array.from(dirs, readPackageNotice).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const assets = {
    LICENSE: fs.readFileSync(path.join(rootDir, 'LICENSE'), 'utf8'),
    NOTICE: fs.readFileSync(path.join(rootDir, 'NOTICE'), 'utf8'),
    'THIRD_PARTY_NOTICES.txt': 'Third-party software notices\n\nThird-party components retain their own copyrights and licenses.\n\n' + packages.map(pkg => pkg.text).join('\n====================\n\n'),
  }
  const dictionary = readDictionaryLicenses(rootDir)
  if (dictionary) assets['DICTIONARY_LICENSES.txt'] = dictionary
  return assets
}

export function distributeLicenses(rootDir) {
  return {
    name: 'distribute-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).filter(output => output.type === 'chunk').flatMap(chunk => Object.keys(chunk.modules))
      for (const [fileName, source] of Object.entries(buildLicenseAssets(ids, rootDir))) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}
