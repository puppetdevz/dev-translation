# Google Translate Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Translate as an alternative translation engine, switchable via settings panel and footer button, with dictionary-powered phonetic/definitions/examples supplement.

**Architecture:** googletrans npm package runs in preload (Node.js) layer, exposed via `window.services.googleTranslate()`. Free Dictionary API also called from preload via `window.services.lookupWord()`. Frontend `translate()` routes by `settings.translationEngine` value, combining Google translation + dictionary data into the existing unified JSON format that `ResultDisplay` already consumes.

**Tech Stack:** googletrans (1.0.28), Free Dictionary API (dictionaryapi.dev), Node.js https module, Vue 3

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/Translate/utils/storage.js` | Modify | Add `translationEngine` default |
| `public/preload/services.js` | Modify | Add `googleTranslate()` and `lookupWord()` |
| `src/Translate/components/SettingsPanel.vue` | Modify | Add engine selector section |
| `src/Translate/index.vue` | Modify | Engine routing in `translate()`, footer toggle button |

---

### Task 1: Add translationEngine to settings storage

**Files:**
- Modify: `src/Translate/utils/storage.js`

- [ ] **Step 1: Add `translationEngine` to DEFAULT_SETTINGS**

In `storage.js`, add the new field to `DEFAULT_SETTINGS`:

```js
const DEFAULT_SETTINGS = {
  showPhonetic: true,
  showDefinitions: true,
  showExamples: true,
  showVariableNaming: true,
  showContextNote: true,
  detectionStrategy: 'regex',
  translationEngine: 'ai',   // 'ai' | 'google'
}
```

The existing `loadSettings()` spread pattern `{ ...DEFAULT_SETTINGS, ...JSON.parse(stored) }` already handles backcompat — users without the field get the `'ai'` default.

- [ ] **Step 2: Build and verify no regressions**

Run: `pnpm build`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/Translate/utils/storage.js
git commit -m "feat: add translationEngine field to settings storage"
```

---

### Task 2: Add googleTranslate to preload services

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 1: Add googleTranslate method**

Add at the top of `services.js` after the existing `require` lines:

```js
const { googletrans } = require('googletrans')
```

Add inside the `window.services = { ... }` object, before `readFile`:

```js
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
```

This method:
- Takes `text`, `from` language code (e.g. `'en'`), `to` language code (e.g. `'zh-CN'`)
- Returns a Promise that resolves to the translated text string
- Times out after 10 seconds
- Wraps errors with a user-friendly message suggesting AI fallback

- [ ] **Step 2: Build to verify syntax**

Run: `pnpm build`
Expected: Build succeeds. The preload script is CommonJS so Vite won't touch it — verify by checking Node can parse it:

Run: `node -e "require('./public/preload/services.js')"`
Expected: Runs without syntax errors (may fail on `window.utools` not being defined in test context, that's expected).

- [ ] **Step 3: Commit**

```bash
git add public/preload/services.js
git commit -m "feat: add googleTranslate method to preload services"
```

---

### Task 3: Add lookupWord to preload services

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 1: Add lookupWord method**

Add inside `window.services = { ... }`, after `googleTranslate`:

```js
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
```

This method:
- Takes an English word, queries Free Dictionary API
- Always resolves — never rejects (silent degradation to empty data)
- Returns `{ phonetic, definitions: [{pos, meaning, example}], examples: [] }` matching the internal format
- Limits to 3 definitions and 2 examples
- Handles 404 (word not found), network errors, timeouts — all resolve to empty data

- [ ] **Step 2: Verify Node syntax**

Run: `node -e "require('./public/preload/services.js')"`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add public/preload/services.js
git commit -m "feat: add lookupWord dictionary method to preload services"
```

---

### Task 4: Add translation engine selector to SettingsPanel

**Files:**
- Modify: `src/Translate/components/SettingsPanel.vue`

- [ ] **Step 1: Add engine selection section to template**

Add the new section **above** the language detection strategy section. In the template, insert after the `<!-- 内容 -->` comment and before `<div class="settings-section">` containing "语言检测策略":

```html
<div class="settings-section">
  <h3 class="section-title">翻译引擎</h3>
  <div class="settings-list">
    <div
      class="setting-item strategy-item"
      :class="{ active: localSettings.translationEngine === 'ai' }"
      @click="localSettings.translationEngine = 'ai'"
    >
      <div class="setting-info">
        <span class="setting-name">AI 模型</span>
        <span class="setting-desc">结构化翻译，含音标、释义、例句</span>
      </div>
      <span class="strategy-check" v-if="localSettings.translationEngine === 'ai'">✓</span>
    </div>
    <div
      class="setting-item strategy-item"
      :class="{ active: localSettings.translationEngine === 'google' }"
      @click="localSettings.translationEngine = 'google'"
    >
      <div class="setting-info">
        <span class="setting-name">Google 翻译</span>
        <span class="setting-desc">免费快速，词典补充音标释义</span>
      </div>
      <span class="strategy-check" v-if="localSettings.translationEngine === 'google'">✓</span>
    </div>
  </div>
</div>
```

This reuses existing `.strategy-item` CSS classes for consistent styling — no new CSS needed.

- [ ] **Step 2: Build to verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Translate/components/SettingsPanel.vue
git commit -m "feat: add translation engine selector to settings panel"
```

---

### Task 5: Wire up engine routing in translate()

**Files:**
- Modify: `src/Translate/index.vue`

- [ ] **Step 1: Add Google translate helper function**

In the `<script setup>` section, add after the `parseResult` function:

```js
// Google 翻译 + 词典补充
const translateWithGoogle = async () => {
  const lang = detectedLanguage.value || detectLanguage(inputText.value)
  detectedLanguage.value = lang

  const type = detectInputType(inputText.value)
  inputType.value = type

  // 检查 preload 是否可用
  if (!window.services || !window.services.googleTranslate) {
    throw new Error('Google 翻译不可用，请切换至 AI 模式')
  }

  const isEnToZh = lang === 'en'
  const fromLang = isEnToZh ? 'en' : 'zh-CN'
  const toLang = isEnToZh ? 'zh-CN' : 'en'

  if (type === 'sentence') {
    // 句子：仅翻译，不查词典
    const translation = await window.services.googleTranslate(inputText.value.trim(), fromLang, toLang)
    return { translation }
  }

  // 单词/短语：翻译 + 词典
  if (isEnToZh) {
    // 英译中：翻译和词典并行
    const [translation, dict] = await Promise.all([
      window.services.googleTranslate(inputText.value.trim(), 'en', 'zh-CN'),
      window.services.lookupWord(inputText.value.trim()),
    ])
    return {
      translation,
      phonetic: dict.phonetic || '',
      definitions: dict.definitions || [],
      examples: dict.examples || [],
    }
  } else {
    // 中译英：先翻译拿到英文译文，再查词典
    const translation = await window.services.googleTranslate(inputText.value.trim(), 'zh-CN', 'en')
    const dict = await window.services.lookupWord(translation)
    return {
      translation,
      phonetic: dict.phonetic || '',
      definitions: dict.definitions || [],
      examples: dict.examples || [],
    }
  }
}
```

- [ ] **Step 2: Modify translate() to route by engine**

Replace the current `translate()` function body (lines 178-217) with:

```js
const translate = async () => {
  if (!inputText.value || !inputText.value.trim()) {
    error.value = '请输入要翻译的内容'
    return
  }

  if (inputText.value.length > 5000) {
    error.value = '文本过长，请控制在5000字符以内'
    return
  }

  isLoading.value = true
  error.value = ''
  translationResult.value = null

  try {
    if (settings.value.translationEngine === 'google') {
      translationResult.value = await translateWithGoogle()
      return
    }

    // AI 路径（现有逻辑，不变）
    const lang = detectedLanguage.value || detectLanguage(inputText.value)
    detectedLanguage.value = lang

    const type = detectInputType(inputText.value)
    inputType.value = type

    const prompt = lang === 'zh'
      ? buildChineseToEnglishPrompt(inputText.value, type)
      : buildEnglishToChinesePrompt(inputText.value, type)

    const result = await window.utools.ai({
      messages: [{ role: 'user', content: prompt }]
    })

    translationResult.value = parseResult(result.content, type)
  } catch (err) {
    console.error('Translation error:', err)
    error.value = err.message || '翻译失败，请重试'
  } finally {
    isLoading.value = false
  }
}
```

- [ ] **Step 3: Build to verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/Translate/index.vue
git commit -m "feat: add Google Translate engine routing in translate()"
```

---

### Task 6: Add footer engine toggle button

**Files:**
- Modify: `src/Translate/index.vue`

- [ ] **Step 1: Add toggle handler**

In the `<script setup>` section, add after `toggleVariableNaming`:

```js
// 切换翻译引擎
const toggleTranslationEngine = () => {
  settings.value = {
    ...settings.value,
    translationEngine: settings.value.translationEngine === 'ai' ? 'google' : 'ai',
  }
  saveSettings(settings.value)
}
```

- [ ] **Step 2: Add button in footer template**

Replace the footer section in template. The current footer structure:

```html
<div class="translate-footer">
  <button class="var-naming-btn" ...>
  <div class="footer-center"><KeyboardShortcuts /></div>
  <button class="settings-btn" ...>
</div>
```

Change to:

```html
<div class="translate-footer">
  <div class="footer-left">
    <button
      class="engine-toggle-btn"
      :class="{ active: settings.translationEngine === 'google' }"
      @click="toggleTranslationEngine"
      :title="settings.translationEngine === 'google' ? 'Google 翻译' : 'AI 翻译'"
    >
      <span>{{ settings.translationEngine === 'google' ? 'G' : 'AI' }}</span>
    </button>
    <button
      class="var-naming-btn"
      :class="{ active: settings.showVariableNaming }"
      @click="toggleVariableNaming"
      title="编程变量命名模式"
    >
      <span>&lt;/&gt;</span>
    </button>
  </div>
  <div class="footer-center">
    <KeyboardShortcuts />
  </div>
  <button class="settings-btn" @click="openSettings" title="设置">
    <span>⚙️</span>
  </button>
</div>
```

- [ ] **Step 3: Update footer CSS**

Replace the `.translate-footer` grid rule and add `.footer-left` and `.engine-toggle-btn` styles.

Update `.translate-footer`:
```css
.translate-footer {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(226, 232, 240, 0.6);
  display: grid;
  grid-template-columns: auto 1fr 32px;
  align-items: center;
  gap: 8px;
  position: relative;
}
```

Add after `.var-naming-btn` styles:
```css
.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.engine-toggle-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.engine-toggle-btn:hover {
  background: white;
  border-color: rgba(99, 102, 241, 0.4);
  color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.engine-toggle-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}
```

- [ ] **Step 4: Add dark mode styles for engine button**

Add in the dark mode `@media` block, alongside the existing `.var-naming-btn` dark styles:

```css
.engine-toggle-btn {
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(51, 65, 85, 0.8);
  color: var(--text-secondary, #94a3b8);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.engine-toggle-btn:hover {
  background: #1e293b;
  border-color: rgba(99, 102, 241, 0.5);
  color: #a5b4fc;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
}

.engine-toggle-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
}
```

- [ ] **Step 5: Build to verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/Translate/index.vue
git commit -m "feat: add translation engine toggle button to footer"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Build production**

Run: `pnpm build`
Expected: Build succeeds, no warnings.

- [ ] **Step 2: Verify file changes**

Run: `git diff --stat main`
Expected: 4 files changed — `storage.js`, `services.js`, `SettingsPanel.vue`, `index.vue`.

- [ ] **Step 3: Verify in uTools**

1. Start dev server: `pnpm dev`
2. In uTools, load the development plugin
3. Verify settings panel shows engine selector (AI / Google)
4. Switch to Google Translate, confirm and test translate
5. Verify footer toggle button switches engine
6. Verify AI mode still works as before
7. Verify dark mode styles for the new button

- [ ] **Step 4: Commit verification notes**

```bash
git add -A
git commit -m "chore: verification notes for Google Translate integration"
```

---

## Test Plan

Since this project lacks an automated test framework, verification is manual:

1. **Settings persistence**: Switch engine in settings panel → close and reopen → engine selection preserved
2. **Footer toggle**: Click footer button → engine swaps → settings panel reflects change
3. **Google translate (en→zh word)**: Type "hello" → switch to Google → translate → see Chinese translation + phonetic + definitions
4. **Google translate (zh→en word)**: Type "你好" → translate → see English translation + phonetic
5. **Google translate (sentence)**: Type "Hello world, how are you?" → translate → see translation only, no definitions
6. **AI fallback**: Switch back to AI → translate → original functionality preserved
7. **Polish unaffected**: In Google mode → click polish → uses AI, works normally
8. **Error handling**: Disconnect network → Google translate → see error message suggesting AI fallback
9. **Dark mode**: Toggle system dark mode → footer buttons style correctly
