import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as vue from 'vue'

/** Execute the real pure-JS <script setup> with real Vue watchers, without a DOM or network. */
export async function runVueScript(fileUrl, { bindings = {}, expose = [], window = {} } = {}) {
  const source = readFileSync(fileUrl, 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const context = { ...bindings, window, defineProps: () => ({ enterAction: {} }) }
  const teardown = []
  const timers = new Map()
  let timerId = 0
  context.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId }
  context.clearTimeout = id => timers.delete(id)
  const imports = [...source.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?$/gm)]
  for (const [, names, path] of imports) {
    let mod
    if (path === 'vue') {
      mod = { ...vue, onMounted: () => {}, onUnmounted: fn => teardown.push(fn) }
    } else if (path === 'vue-router') {
      mod = { useRouter: () => ({ push() {} }), useRoute: () => ({ query: {} }) }
    } else if (path.endsWith('.vue') || path.endsWith('/useSettings.js')) {
      mod = {}
    } else {
      mod = await import(new URL(path, fileUrl).href)
    }
    if (names.trim().startsWith('{')) {
      for (const name of names.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)) {
        const [original, local = original] = name.split(/\s+as\s+/)
        if (!(local in context)) context[local] = mod[original]
      }
    } else if (!(names.trim() in context)) {
      context[names.trim()] = mod.default || {}
    }
  }
  const script = source.replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?$/gm, '')
  const scope = vue.effectScope()
  const state = scope.run(() => runInNewContext(`(() => { ${script}\nreturn { ${expose.join(',')} }; })()`, context))
  return {
    state,
    async fireTimers(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue
        timers.delete(id)
        await timer.fn()
      }
      await vue.nextTick()
    },
    dispose() {
      for (const fn of teardown) fn()
      scope.stop()
      timers.clear()
    },
  }
}
