<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '../utils/useSettings.js'

const router = useRouter()
const { settings, updateSetting, toggleSetting } = useSettings()

const handleBack = () => {
  router.push({ name: 'translate' })
}

const handleStrategySelect = (strategy) => {
  updateSetting('detectionStrategy', strategy)
}

const engineMeta = {
  ai: { icon: '⚡', name: 'uTools AI' },
  'thirdparty-ai': { icon: '🧠', name: '自定义 AI' },
  google: { brand: 'G', brandClass: 'brand-google', name: 'Google 翻译' },
  deepl: { brand: 'D', brandClass: 'brand-deepl', name: 'DeepL 官方' },
  deeplx: { brand: 'X', brandClass: 'brand-deeplx', name: 'DeepLX 自部署' },
}

const mainEngine = computed(() => (settings.failoverOrder && settings.failoverOrder[0]) || 'ai')

const selectedEngine = ref((settings.failoverOrder && settings.failoverOrder[0]) || 'ai')

const selectEngine = (engine) => {
  selectedEngine.value = engine
}

const dragIndex = ref(null)
const dragOverIndex = ref(null)

const onDragStart = (index) => { dragIndex.value = index }
const onDragOver = (index) => {
  if (dragIndex.value === null || dragIndex.value === index) return
  dragOverIndex.value = index
}
const onDrop = (index) => {
  if (dragIndex.value === null || dragIndex.value === index) return
  const newOrder = [...settings.failoverOrder]
  const [moved] = newOrder.splice(dragIndex.value, 1)
  newOrder.splice(index, 0, moved)
  updateSetting('failoverOrder', newOrder)
  dragIndex.value = null
  dragOverIndex.value = null
}
const onDragEnd = () => {
  dragIndex.value = null
  dragOverIndex.value = null
}

const openDeeplSignup = () => {
  window.utools.shellOpenExternal('https://www.deepl.com/pro-api')
}

const openDeeplxGuide = () => {
  window.utools.shellOpenExternal('https://github.com/OwO-Network/DeepLX')
}

// 第三方 AI 模型列表远程获取
const fetchingModels = ref(false)
const modelList = ref([])
const modelListError = ref('')

const handleFetchModels = async () => {
  if (fetchingModels.value) return
  if (!settings.thirdpartyAiUrl || !settings.thirdpartyAiUrl.trim()) {
    modelListError.value = '请先填写 API 链接'
    modelList.value = []
    return
  }
  if (!settings.thirdpartyAiKey || !settings.thirdpartyAiKey.trim()) {
    modelListError.value = '请先填写 API Key'
    modelList.value = []
    return
  }
  if (!window.services || !window.services.fetchThirdpartyModels) {
    modelListError.value = '服务不可用'
    return
  }
  fetchingModels.value = true
  modelListError.value = ''
  modelList.value = []
  try {
    const models = await window.services.fetchThirdpartyModels(
      settings.thirdpartyAiUrl,
      settings.thirdpartyAiKey
    )
    modelList.value = models
  } catch (err) {
    modelListError.value = err.message || '获取模型失败'
  } finally {
    fetchingModels.value = false
  }
}

const selectModel = (model) => {
  updateSetting('thirdpartyAiModel', model)
}

const aiOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: 'AI 生成美式 IPA 音标' },
  { key: 'showDefinitions', label: '显示释义', desc: 'AI 生成 3-5 条英文释义' },
  { key: 'showExamples', label: '显示例句', desc: 'AI 生成 3-5 条英文例句' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
  { key: 'showContextNote', label: '显示语境说明', desc: 'AI 补充单词使用场景说明' },
]

const googleOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: '词典查询获取音标' },
  { key: 'showDefinitions', label: '显示释义', desc: '词典查询获取释义' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
]

const deeplOutputs = [
  { key: 'showPhonetic', label: '显示音标', desc: '词典查询获取音标' },
  { key: 'showDefinitions', label: '显示释义', desc: '词典查询获取释义' },
  { key: 'showVariableNaming', label: '显示变量命名', desc: '基于翻译结果生成 5 种编程命名格式' },
]
</script>

<template>
  <div class="settings-page">
    <div class="settings-topbar">
      <button class="back-btn" @click="handleBack">
        <span>←</span>
      </button>
      <span class="topbar-title">设置</span>
    </div>

    <div class="settings-body">
      <div class="settings-section">
        <h3 class="section-title">语言检测策略</h3>
        <div class="strategy-list">
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'regex' }"
            @click="handleStrategySelect('regex')"
          >
            <div class="strategy-info">
              <span class="strategy-name">正则算法</span>
              <span class="strategy-desc">基于字符占比快速识别，无需 AI 调用</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'regex'">✓</span>
          </div>
          <div
            class="strategy-item"
            :class="{ active: settings.detectionStrategy === 'ai' }"
            @click="handleStrategySelect('ai')"
          >
            <div class="strategy-info">
              <span class="strategy-name">AI 模型</span>
              <span class="strategy-desc">调用 AI 识别，更准确（有延迟）</span>
            </div>
            <span class="strategy-check" v-if="settings.detectionStrategy === 'ai'">✓</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-title">翻译引擎配置</h3>
        <p class="section-hint">拖拽列表调整故障转移顺序（首位为主引擎），点击查看引擎配置。</p>
        <div class="engine-layout">
          <!-- 左列：引擎列表（拖拽调序 + 点击选中） -->
          <div class="engine-list">
            <template v-for="(engine, index) in settings.failoverOrder" :key="engine">
              <div
                v-if="engineMeta[engine]"
                class="engine-card"
                :class="{
                  active: selectedEngine === engine,
                  dragging: dragIndex === index,
                  'drag-over': dragOverIndex === index && dragIndex !== index
                }"
                draggable="true"
                @dragstart="onDragStart(index)"
                @dragover.prevent="onDragOver(index)"
                @drop="onDrop(index)"
                @dragend="onDragEnd"
                @click="selectEngine(engine)"
              >
                <span class="engine-drag-handle">⠿</span>
                <span v-if="engineMeta[engine].icon" class="engine-card-icon">{{ engineMeta[engine].icon }}</span>
                <span v-else class="brand-badge" :class="engineMeta[engine].brandClass">{{ engineMeta[engine].brand }}</span>
                <div class="engine-card-info">
                  <span class="engine-card-name">{{ engineMeta[engine].name }}</span>
                </div>
                <span class="engine-priority">P{{ index + 1 }}</span>
              </div>
            </template>
          </div>

          <!-- 右列：选中引擎的具体配置 + 输出设置 -->
          <div class="engine-config-area">
            <Transition name="output-fade" mode="out-in">
              <div :key="selectedEngine" class="engine-config-content">
                <!-- 选中引擎的配置 -->
                <template v-if="selectedEngine === 'deepl'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">DeepL API Key</label>
                    <input class="deepl-api-input" type="password" :value="settings.deeplApiKey" @input="updateSetting('deeplApiKey', $event.target.value)" placeholder="粘贴你的 DeepL API Key（Free 版以 :fx 结尾）" />
                    <p class="deepl-config-hint">免费注册获取 API Key（50 万字符/月，无需信用卡）：<a class="deepl-link" @click="openDeeplSignup">前往 DeepL 注册</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'deeplx'">
                  <div class="deepl-config" style="margin-top: 0;">
                    <label class="deepl-config-label">服务器地址</label>
                    <input class="deepl-api-input" type="text" :value="settings.deeplxServerUrl" @input="updateSetting('deeplxServerUrl', $event.target.value)" placeholder="http://localhost:1188 或 https://api.deeplxxx.org" />
                    <label class="deepl-config-label" style="margin-top: 10px;">访问令牌（可选）</label>
                    <input class="deepl-api-input" type="password" :value="settings.deeplxToken" @input="updateSetting('deeplxToken', $event.target.value)" placeholder="填写后将自动拼接为 地址/令牌/translate" />
                    <p class="deepl-config-hint">支持直接填写完整 URL（含令牌），或分别填写地址和令牌自动拼接。自部署 DeepLX：<a class="deepl-link" @click="openDeeplxGuide">部署指南</a></p>
                  </div>
                </template>
                <template v-else-if="selectedEngine === 'thirdparty-ai'">
                  <div class="thirdparty-ai-config" style="margin-top: 0;">
                    <label class="deepl-config-label">API 链接</label>
                    <input class="deepl-api-input" type="text" :value="settings.thirdpartyAiUrl" @input="updateSetting('thirdpartyAiUrl', $event.target.value)" placeholder="https://api.openai.com/v1（只需填到 v1）" />
                    <label class="deepl-config-label" style="margin-top: 10px;">API Key</label>
                    <input class="deepl-api-input" type="password" :value="settings.thirdpartyAiKey" @input="updateSetting('thirdpartyAiKey', $event.target.value)" placeholder="sk-..." />
                    <label class="deepl-config-label" style="margin-top: 10px;">模型</label>
                    <div class="model-input-row">
                      <input class="deepl-api-input model-input" type="text" :value="settings.thirdpartyAiModel" @input="updateSetting('thirdpartyAiModel', $event.target.value)" placeholder="gpt-4o / deepseek-chat / qwen-plus" />
                      <button class="fetch-models-btn" :disabled="fetchingModels" @click="handleFetchModels">
                        <span v-if="!fetchingModels">获取模型</span>
                        <span v-else class="fetch-models-loading">
                          <span class="loading-dot"></span>
                          <span class="loading-dot"></span>
                          <span class="loading-dot"></span>
                        </span>
                      </button>
                    </div>
                    <p v-if="modelListError" class="model-fetch-error">{{ modelListError }}</p>
                    <div v-if="modelList.length" class="model-list">
                      <button
                        v-for="m in modelList"
                        :key="m"
                        class="model-chip"
                        :class="{ active: m === settings.thirdpartyAiModel }"
                        :title="m"
                        @click="selectModel(m)"
                      >{{ m }}</button>
                    </div>
                    <label class="deepl-config-label" style="margin-top: 10px;">系统提示词（翻译时追加到默认指令）</label>
                    <textarea class="thirdparty-ai-prompt" :value="settings.thirdpartyAiSystemPrompt" @input="updateSetting('thirdpartyAiSystemPrompt', $event.target.value)" placeholder="可选。填写后作为 system role，user role 仍放默认翻译指令。留空仅用默认指令。" rows="4"></textarea>
                    <p class="deepl-config-hint">兼容 OpenAI 协议（Bearer Key 认证）。API 链接只需填到 <code class="hint-code">/v1</code>，程序自动补全 <code class="hint-code">/chat/completions</code>。支持 OpenAI/DeepSeek/通义千问/Moonshot 等。系统提示词留空时仅用默认翻译指令。</p>
                  </div>
                </template>
                <template v-else>
                  <div class="engine-no-config">
                    <span v-if="engineMeta[selectedEngine].icon" class="engine-no-config-icon">{{ engineMeta[selectedEngine].icon }}</span>
                    <span v-else class="brand-badge" :class="engineMeta[selectedEngine].brandClass">{{ engineMeta[selectedEngine].brand }}</span>
                    <span>{{ engineMeta[selectedEngine].name }} 无需额外配置</span>
                  </div>
                </template>

                <div class="config-divider"></div>

                <!-- 输出设置：基于主引擎（failoverOrder[0]），不随选中引擎变化 -->
                <div class="outputs-list">
                  <div
                    v-for="item in (mainEngine === 'ai' || mainEngine === 'thirdparty-ai') ? aiOutputs : (mainEngine === 'deepl' || mainEngine === 'deeplx') ? deeplOutputs : googleOutputs"
                    :key="item.key"
                    class="output-item"
                  >
                    <div class="output-info">
                      <span class="output-name">{{ item.label }}</span>
                      <span class="output-desc">{{ item.desc }}</span>
                    </div>
                    <button
                      class="toggle-switch"
                      :class="{ active: settings[item.key] }"
                      @click="toggleSetting(item.key)"
                    >
                      <span class="toggle-slider"></span>
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: var(--text-primary, #1e293b);
  overflow: hidden;
}

.settings-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  flex-shrink: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary, #64748b);
  transition: all 0.2s;
}

.back-btn:hover {
  background: white;
  color: var(--text-primary, #1e293b);
  transform: translateX(-1px);
}

.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
}

.settings-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.strategy-list {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.strategy-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-item:hover {
  background: rgba(241, 245, 249, 1);
}

.strategy-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.strategy-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strategy-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.strategy-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.strategy-check {
  color: #6366f1;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}

/* Engine left-right layout */
.engine-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.engine-list {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.engine-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 10px;
  cursor: grab;
  transition: all 0.2s;
  user-select: none;
}

.engine-card:hover {
  background: rgba(241, 245, 249, 1);
  border-color: rgba(99, 102, 241, 0.3);
}

.engine-card.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}

.engine-card.dragging {
  opacity: 0.5;
}

.engine-card.drag-over {
  border-top: 2px solid #6366f1;
}

.engine-drag-handle {
  font-size: 16px;
  color: var(--text-secondary, #94a3b8);
  cursor: grab;
  flex-shrink: 0;
  line-height: 1;
  transition: color 0.2s;
}

.engine-card:hover .engine-drag-handle {
  color: #6366f1;
}

.engine-card-icon {
  font-size: 18px;
  flex-shrink: 0;
}

/* 品牌色圆牌字母：用于 Google/DeepL/DeepLX（emoji 无官方图标的品牌） */
.brand-badge {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: -0.5px;
  user-select: none;
}

.brand-google { background: #4285F4; }
.brand-deepl { background: #0F2B46; }
.brand-deeplx { background: #f97316; }

.engine-card-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.engine-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

/* 故障转移优先级徽章：P1=主引擎，与 P2+ 样式一致 */
.engine-priority {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text-secondary, #64748b);
  background: rgba(226, 232, 240, 0.6);
  border: 1px solid rgba(203, 213, 224, 0.8);
  padding: 2px 7px;
  border-radius: 6px;
  flex-shrink: 0;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.section-hint {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin: -8px 0 12px 0;
  line-height: 1.4;
}

.engine-config-area {
  flex: 1;
  min-width: 0;
}

.engine-config-content {
  /* wrapper for config + outputs */
}

.engine-no-config {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.engine-no-config-icon {
  font-size: 16px;
}

.config-divider {
  height: 1px;
  background: rgba(226, 232, 240, 0.6);
  margin: 16px 0;
}

.deepl-config {
  padding: 12px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
}

.deepl-config-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  margin-bottom: 8px;
}

.deepl-api-input {
  width: 100%;
  padding: 10px 12px;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary, #1e293b);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.deepl-api-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.deepl-api-input::placeholder {
  color: var(--text-secondary, #94a3b8);
}

.thirdparty-ai-prompt {
  width: 100%;
  padding: 10px 12px;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #1e293b);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
}

.thirdparty-ai-prompt:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.thirdparty-ai-prompt::placeholder {
  color: var(--text-secondary, #94a3b8);
}

/* 模型输入框 + 获取按钮组合 */
.model-input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.model-input {
  flex: 1;
  min-width: 0;
}

.fetch-models-btn {
  flex-shrink: 0;
  padding: 0 14px;
  background: #6366f1;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  font-family: inherit;
}

.fetch-models-btn:hover:not(:disabled) {
  background: #4f46e5;
}

.fetch-models-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.fetch-models-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* 加载中三个跳动点 */
.fetch-models-loading {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.fetch-models-loading .loading-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ffffff;
  animation: fetch-loading-bounce 1.2s infinite ease-in-out;
}

.fetch-models-loading .loading-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.fetch-models-loading .loading-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes fetch-loading-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.model-fetch-error {
  margin-top: 6px;
  font-size: 12px;
  color: #ef4444;
  line-height: 1.4;
}

.model-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 8px;
}

.model-chip {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(203, 213, 224, 0.8);
  border-radius: 6px;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chip:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.4);
}

.model-chip.active {
  background: #6366f1;
  color: #ffffff;
  border-color: #6366f1;
}

.model-list::-webkit-scrollbar {
  width: 6px;
}

.model-list::-webkit-scrollbar-track {
  background: transparent;
}

.model-list::-webkit-scrollbar-thumb {
  background: rgba(99, 102, 241, 0.3);
  border-radius: 3px;
}

.deepl-config-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.4;
}

.deepl-link {
  color: #6366f1;
  cursor: pointer;
  text-decoration: underline;
}

.deepl-link:hover {
  color: #4f46e5;
}

.hint-code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  padding: 1px 5px;
  border-radius: 4px;
}

.outputs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.8);
  border-radius: 10px;
  transition: background 0.2s;
}

.output-item:hover {
  background: rgba(241, 245, 249, 1);
}

.output-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.output-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.output-desc {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.output-fade-enter-active,
.output-fade-leave-active {
  transition: opacity 0.15s ease;
}

.output-fade-enter-from,
.output-fade-leave-to {
  opacity: 0;
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 28px;
  background: rgba(203, 213, 224, 0.8);
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.3s;
  flex-shrink: 0;
}

.toggle-switch.active {
  background: #6366f1;
}

.toggle-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-slider {
  transform: translateX(20px);
}

.settings-body::-webkit-scrollbar {
  width: 6px;
}

.settings-body::-webkit-scrollbar-track {
  background: transparent;
}

.settings-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

@media (prefers-color-scheme: dark) {
  .settings-page {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: var(--text-primary, #f1f5f9);
  }

  .settings-topbar {
    background: rgba(30, 41, 59, 0.8);
    border-bottom: 1px solid rgba(51, 65, 85, 0.6);
  }

  .topbar-title {
    color: var(--text-primary, #f1f5f9);
  }

  .back-btn {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-secondary, #94a3b8);
  }

  .back-btn:hover {
    background: #1e293b;
    color: var(--text-primary, #f1f5f9);
  }

  .section-title {
    color: var(--text-secondary, #94a3b8);
  }

  .strategy-item,
  .output-item {
    background: rgba(15, 23, 42, 0.6);
  }

  .strategy-item:hover,
  .output-item:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .strategy-item.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .strategy-name,
  .output-name {
    color: var(--text-primary, #f1f5f9);
  }

  .strategy-desc,
  .output-desc {
    color: var(--text-secondary, #64748b);
  }

  .engine-no-config {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
    color: var(--text-secondary, #94a3b8);
  }

  .config-divider {
    background: rgba(51, 65, 85, 0.6);
  }

  .toggle-switch {
    background: rgba(71, 85, 105, 0.8);
  }

  .deepl-api-input {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
    color: var(--text-primary, #f1f5f9);
  }

  .thirdparty-ai-prompt {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .thirdparty-ai-prompt:focus {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .thirdparty-ai-prompt::placeholder {
    color: var(--text-secondary, #64748b);
  }

  .hint-code {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }

  .model-list {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
  }

  .model-chip {
    background: rgba(30, 41, 59, 0.6);
    border-color: rgba(51, 65, 85, 0.8);
    color: var(--text-primary, #f1f5f9);
  }

  .model-chip:hover {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .model-chip.active {
    background: #6366f1;
    color: #ffffff;
    border-color: #6366f1;
  }

  .settings-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .engine-card {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(51, 65, 85, 0.6);
  }

  .engine-card:hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .engine-card.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .engine-priority {
    color: var(--text-secondary, #94a3b8);
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(71, 85, 105, 0.8);
  }

  .engine-card-name {
    color: var(--text-primary, #f1f5f9);
  }

  .section-hint {
    color: var(--text-secondary, #64748b);
  }
}

@media (max-width: 768px) {
  .settings-body {
    padding: 16px 12px;
  }
}

@media (max-width: 640px) {
  .strategy-desc {
    display: none;
  }

  .strategy-item {
    padding: 10px 12px;
  }

  .strategy-name {
    font-size: 13px;
  }

  .engine-layout {
    flex-direction: column;
  }

  .engine-list {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }

  .engine-card {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    gap: 6px;
  }

  .engine-card-info {
    flex-direction: column;
    gap: 2px;
  }

  .engine-card-name {
    font-size: 12px;
  }
}
</style>
