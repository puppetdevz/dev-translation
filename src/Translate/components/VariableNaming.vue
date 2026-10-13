<script setup>
import { computed } from 'vue'
import { useCopyToast } from '../utils/useCopyToast.js'
import { buildRegularVariableNames, formatVariableNames } from '../utils/variableNaming.js'

const props = defineProps({
  englishText: { type: String, default: '' },
  /** 常规命名行开关（showVariableNaming，保持原有键与行为） */
  enabled: { type: Boolean, default: false },
  /** AI 命名行开关（showAiNaming，独立于常规行） */
  aiEnabled: { type: Boolean, default: false },
  /** 'off' | 'loading' | 'ready' | 'none' | 'failed' | 'timeout' | 'unconfigured' | 'too-long' */
  aiStatus: { type: String, default: 'off' },
  aiWords: { type: Array, default: () => [] },
  /** 无可用来源等状态的安全提示文案（不含 URL/凭据/原文） */
  aiMessage: { type: String, default: '' },
})

const emit = defineEmits(['retry'])

const { toastVisible, toastText, copyWithToast } = useCopyToast()

const regularNames = computed(() => buildRegularVariableNames(props.englishText))
const aiNames = computed(() => formatVariableNames(props.aiWords))

const showRegularRow = computed(() => props.enabled && regularNames.value.length > 0)

/** AI 行状态；关闭或无状态时为空，不留占位。 */
const aiRowStatus = computed(() => {
  if (!props.aiEnabled) return ''
  switch (props.aiStatus) {
    case 'ready':
      return aiNames.value.length ? 'ready' : ''
    case 'loading':
    case 'none':
    case 'failed':
    case 'timeout':
    case 'unconfigured':
    case 'too-long':
    case 'stale':
      return props.aiStatus
    default:
      return ''
  }
})

const aiCanRetry = computed(() => (
  aiRowStatus.value === 'failed'
  || aiRowStatus.value === 'timeout'
  || aiRowStatus.value === 'stale'
))

const aiHint = computed(() => {
  switch (aiRowStatus.value) {
    case 'loading': return 'AI 命名生成中…'
    case 'none': return '无需变量命名'
    case 'failed': return 'AI 命名失败'
    case 'timeout': return 'AI 命名超时'
    case 'too-long': return '输入过长，暂不生成 AI 命名'
    case 'unconfigured': return props.aiMessage || '未配置可用的 AI 来源，请在设置中检查已有 AI 配置与顺序'
    case 'stale': return 'AI 配置已变更，可重新生成'
    default: return ''
  }
})

const visible = computed(() => showRegularRow.value || !!aiRowStatus.value)

const handleRetry = () => {
  if (!aiCanRetry.value) return
  emit('retry')
}
</script>

<template>
  <div v-if="visible" class="variable-naming">
    <div class="variable-header"><span class="variable-label">变量命名</span></div>

    <div v-if="showRegularRow" class="naming-row">
      <span class="naming-row-title">常规命名</span>
      <div class="naming-tags">
        <button
          v-for="item in regularNames"
          :key="item.label"
          type="button"
          class="naming-tag"
          :title="item.value"
          @click="copyWithToast(item.value)"
        >
          <span class="tag-format">{{ item.label }}</span>
          <code class="tag-value">{{ item.value }}</code>
        </button>
      </div>
    </div>

    <div v-if="aiRowStatus" class="naming-row">
      <span class="naming-row-title">AI 命名</span>
      <div class="naming-tags">
        <template v-if="aiRowStatus === 'ready'">
          <button
            v-for="item in aiNames"
            :key="item.label"
            type="button"
            class="naming-tag"
            :title="item.value"
            @click="copyWithToast(item.value)"
          >
            <span class="tag-format">{{ item.label }}</span>
            <code class="tag-value">{{ item.value }}</code>
          </button>
        </template>
        <template v-else>
          <span class="naming-hint" :class="{ 'is-error': aiRowStatus === 'failed' || aiRowStatus === 'timeout' }">{{ aiHint }}</span>
          <button
            v-if="aiCanRetry"
            type="button"
            class="naming-retry"
            @click="handleRetry"
          >重试</button>
        </template>
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
.variable-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.variable-label { font-size: 12px; font-weight: 600; color: var(--text-secondary, #64748b); line-height: 1; }

.naming-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.naming-row + .naming-row { margin-top: 5px; }
.naming-row-title {
  flex: 0 0 auto;
  width: 56px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 600;
  line-height: 1.4;
}
.naming-tags {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
  padding-bottom: 1px;
}
.naming-tags::-webkit-scrollbar { height: 4px; }
.naming-tags::-webkit-scrollbar-track { background: transparent; }
.naming-tags::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.5); border-radius: 2px; }

.naming-tag {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 3px 8px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 6px;
  background: rgba(248, 250, 252, 0.9);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.naming-tag:hover { background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.35); }
.naming-tag:active { transform: scale(0.98); }
.naming-tag:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.6); outline-offset: 1px; }
.tag-format { font-size: 10px; color: var(--text-secondary, #94a3b8); font-family: monospace; flex: 0 0 auto; }
.tag-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  font-family: 'SFMono-Regular', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.naming-hint { font-size: 11px; color: var(--text-secondary, #94a3b8); }
.naming-hint.is-error { color: #dc2626; }
.naming-retry {
  flex: 0 0 auto;
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 6px;
  background: transparent;
  color: #6366f1;
  cursor: pointer;
  transition: background 0.15s ease;
}
.naming-retry:hover { background: rgba(99, 102, 241, 0.1); }

.copy-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #667eea, #764ba2); color: white; font-size: 12px; padding: 6px 14px; border-radius: 999px; z-index: 100; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }

@media (prefers-color-scheme: dark) {
  .variable-naming { background: #1e293b; border-color: rgba(51, 65, 85, 0.6); }
  .naming-tag { background: rgba(15, 23, 42, 0.6); border-color: rgba(51, 65, 85, 0.8); }
  .naming-tag:hover { background: rgba(99, 102, 241, 0.18); border-color: rgba(99, 102, 241, 0.45); }
  .tag-value { color: var(--text-primary, #f1f5f9); }
  .naming-hint.is-error { color: #f87171; }
  .naming-retry { color: #a5b4fc; border-color: rgba(165, 180, 252, 0.4); }
  .naming-retry:hover { background: rgba(99, 102, 241, 0.2); }
  .naming-tags::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.6); }
}
</style>
