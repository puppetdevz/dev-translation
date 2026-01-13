<script lang="ts" setup>
// 快捷键提示组件
</script>

<template>
  <div class="keyboard-shortcuts">
    <div class="shortcuts-container">
      <div class="shortcut">
        <kbd>Enter</kbd>
        <span class="shortcut-label">翻译</span>
      </div>
      <div class="shortcut-divider"></div>
      <div class="shortcut">
        <kbd>Shift</kbd>
        <span class="shortcut-plus">+</span>
        <kbd>Enter</kbd>
        <span class="shortcut-label">换行</span>
      </div>
      <div class="shortcut-divider"></div>
      <div class="shortcut">
        <kbd>Esc</kbd>
        <span class="shortcut-label">关闭</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyboard-shortcuts {
  width: 100%;
}

.shortcuts-container {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: center;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary, #8492a6);
  transition: color 0.2s ease;
}

.shortcut:hover {
  color: var(--text-primary, #2c3e50);
}

.shortcut-label {
  font-weight: 500;
}

.shortcut-plus {
  font-size: 11px;
  opacity: 0.6;
}

.shortcut-divider {
  width: 1px;
  height: 16px;
  background: rgba(0, 0, 0, 0.1);
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  font-weight: 600;
  line-height: 1;
  color: var(--text-primary, #2c3e50);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(240, 240, 240, 0.9) 100%);
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  transition: all 0.2s ease;
}

kbd:hover {
  transform: translateY(-1px);
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

@media (prefers-color-scheme: dark) {
  .shortcut {
    color: var(--text-secondary, #a0aec0);
  }

  .shortcut:hover {
    color: var(--text-primary, #e0e0e0);
  }

  .shortcut-divider {
    background: rgba(255, 255, 255, 0.15);
  }

  kbd {
    color: var(--text-primary, #e0e0e0);
    background: linear-gradient(180deg, rgba(60, 60, 60, 0.9) 0%, rgba(40, 40, 40, 0.9) 100%);
    border-color: rgba(255, 255, 255, 0.2);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  kbd:hover {
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
}

@media (max-width: 768px) {
  .shortcuts-container {
    gap: 12px;
  }

  .shortcut {
    font-size: 12px;
  }

  kbd {
    min-width: 20px;
    padding: 3px 6px;
    font-size: 11px;
  }
}
</style>
