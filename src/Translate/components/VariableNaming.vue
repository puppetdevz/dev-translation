<script setup>
import { computed } from 'vue'
import { useCopyToast } from '../utils/useCopyToast.js'

const props = defineProps({
  englishText: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
})

const { toastVisible, toastText, copyWithToast } = useCopyToast()

const variableNames = computed(() => {
  // 变量名只取英文词元；句子末尾标点不能进入标识符。
  const words = (props.englishText.match(/[A-Za-z][A-Za-z0-9]*/g) || []).map(w => w.toLowerCase())
  if (!words.length) return []
  const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  return [
    { label: 'camelCase', value: words[0] + words.slice(1).map(capitalize).join('') },
    { label: 'PascalCase', value: words.map(capitalize).join('') },
    { label: 'snake_case', value: words.join('_') },
    { label: 'UPPER_CASE', value: words.join('_').toUpperCase() },
    { label: 'kebab-case', value: words.join('-') },
  ]
})
</script>

<template>
  <div v-if="enabled && variableNames.length" class="variable-naming">
    <div class="variable-header"><span class="variable-label">变量命名</span></div>
    <div class="variable-list">
      <div v-for="item in variableNames" :key="item.label" class="variable-item" @click="copyWithToast(item.value)">
        <span class="variable-format">{{ item.label }}</span>
        <code class="variable-value">{{ item.value }}</code>
      </div>
    </div>
    <Transition name="toast">
      <div v-if="toastVisible" class="copy-toast">{{ toastText }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.variable-naming {
  padding: 10px 12px;
  background: white;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.variable-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.variable-label { font-size: 12px; font-weight: 600; color: var(--text-secondary, #64748b); line-height: 1; }
.variable-list { display: flex; flex-direction: column; gap: 4px; }
.variable-item { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease; }
.variable-item:hover { background: rgba(99, 102, 241, 0.06); }
.variable-format { font-size: 11px; color: var(--text-secondary, #94a3b8); font-family: monospace; width: 80px; flex-shrink: 0; }
.variable-value { font-size: 13px; font-weight: 600; color: var(--text-primary, #1e293b); font-family: 'SFMono-Regular', Consolas, monospace; overflow-wrap: anywhere; }
.copy-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #667eea, #764ba2); color: white; font-size: 12px; padding: 6px 14px; border-radius: 999px; z-index: 100; }
@media (prefers-color-scheme: dark) {
  .variable-naming { background: #1e293b; border-color: rgba(51, 65, 85, 0.6); }
  .variable-item:hover { background: rgba(99, 102, 241, 0.1); }
  .variable-value { color: var(--text-primary, #f1f5f9); }
}
</style>
