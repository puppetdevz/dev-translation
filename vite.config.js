import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { distributeLicenses } from './scripts/distributionLicenses.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * 把 preload 运行时依赖复制进 dist，确保已安装/打包实例能解析 require。
 * 开发插件可通过向上查找项目 node_modules 工作；.asar 安装包不会包含仓库根 node_modules。
 */
function copyPreloadDependencies() {
  const pkgName = 'google-translate-api-x'
  return {
    name: 'copy-preload-dependencies',
    apply: 'build',
    closeBundle() {
      const src = path.join(rootDir, 'node_modules', pkgName)
      const dest = path.join(rootDir, 'dist', 'preload', 'node_modules', pkgName)
      if (!fs.existsSync(src)) {
        throw new Error(`[copy-preload-dependencies] 未找到 ${pkgName}，无法写入安装包。请先执行 pnpm install`)
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.rmSync(dest, { recursive: true, force: true })
      // pnpm 下 node_modules 里是 symlink，必须 dereference，否则安装包内的链接指向开发机路径。
      fs.cpSync(src, dest, { recursive: true, dereference: true })
      if (fs.lstatSync(dest).isSymbolicLink()) {
        throw new Error(`[copy-preload-dependencies] ${pkgName} 仍为 symlink，安装包将无法解析`)
      }
      if (!fs.existsSync(path.join(dest, 'package.json'))) {
        throw new Error(`[copy-preload-dependencies] ${pkgName} 缺少 package.json`)
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), distributeLicenses(rootDir), copyPreloadDependencies()],
  base: './'
})
