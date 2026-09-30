import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildLicenseAssets } from './distributionLicenses.mjs'

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-license-test-'))
  try {
    fs.writeFileSync(path.join(root, 'LICENSE'), 'project GPL license text\n')
    fs.writeFileSync(path.join(root, 'NOTICE'), 'Copyright project owner\n')
    const addPackage = (name, license = 'MIT', text = `Copyright ${name}\nPermission is hereby granted\n`) => {
      const dir = path.join(root, 'node_modules', name)
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }))
      if (text !== null) fs.writeFileSync(path.join(dir, 'LICENSE'), text)
      return path.join(dir, 'dist', 'index.js')
    }
    addPackage('google-translate-api-x')
    run({ root, addPackage })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('分发许可资产', () => {
  it('包含项目原始许可、实际打包依赖及 preload 依赖完整文本，且去重排序', () => withFixture(({ root, addPackage }) => {
    const vue = addPackage('vue')
    const router = addPackage('vue-router')
    const assets = buildLicenseAssets([router, `${vue}?query=1`, vue, '\0virtual:module'], root)
    assert.equal(assets['LICENSE'], 'project GPL license text\n')
    assert.equal(assets['NOTICE'], 'Copyright project owner\n')
    const notices = assets['THIRD_PARTY_NOTICES.txt']
    assert.match(notices, /google-translate-api-x@1\.0\.0/)
    assert.match(notices, /vue-router@1\.0\.0/)
    assert.match(notices, /Copyright vue\nPermission is hereby granted/)
    assert.equal(notices.split('vue@1.0.0').length, 2)
    assert.ok(notices.indexOf('google-translate-api-x@') < notices.indexOf('vue@'))
    assert.ok(!notices.includes(root), '产物不得包含开发机绝对路径')
  }))

  it('第三方许可文本缺失时阻止分发，不能静默遗漏', () => withFixture(({ root, addPackage }) => {
    const unknown = addPackage('missing-license', 'MIT', null)
    assert.throws(() => buildLicenseAssets([unknown], root), /missing-license.*许可文本/)
  }))

  it('保留 NOTICE 和多许可证文件的原始内容', () => withFixture(({ root, addPackage }) => {
    const module = addPackage('dual-license', '(MIT OR Apache-2.0)')
    const dir = path.dirname(path.dirname(module))
    fs.writeFileSync(path.join(dir, 'LICENSE-APACHE'), 'Apache original terms\n')
    fs.writeFileSync(path.join(dir, 'NOTICE'), 'Original attribution\n')
    const text = buildLicenseAssets([module], root)['THIRD_PARTY_NOTICES.txt']
    assert.match(text, /\(MIT OR Apache-2\.0\)/)
    assert.match(text, /Apache original terms\n/)
    assert.match(text, /Original attribution\n/)
  }))
})
