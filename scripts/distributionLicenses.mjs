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

// 仅汇总实际输出 chunk 的依赖，另加以原始文件分发的 preload 运行时依赖。
// 原始许可/NOTICE 原文保留，输出不包含开发机路径；更新依赖后随构建重新生成。
export function buildLicenseAssets(moduleIds, rootDir) {
  const dirs = new Set([path.join(rootDir, 'node_modules', 'google-translate-api-x')])
  for (const id of moduleIds) {
    const dir = findPackageRoot(id)
    if (dir) dirs.add(dir)
  }
  const packages = Array.from(dirs, readPackageNotice).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return {
    LICENSE: fs.readFileSync(path.join(rootDir, 'LICENSE'), 'utf8'),
    NOTICE: fs.readFileSync(path.join(rootDir, 'NOTICE'), 'utf8'),
    'THIRD_PARTY_NOTICES.txt': 'Third-party software notices\n\nThird-party components retain their own copyrights and licenses.\n\n' + packages.map(pkg => pkg.text).join('\n====================\n\n'),
  }
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
