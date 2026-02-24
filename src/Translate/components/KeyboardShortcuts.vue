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
  background: rgba(226, 232, 240, 0.6);
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
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
}

kbd:hover {
  transform: translateY(-1px);
  border-color: rgba(203, 213, 224, 1);
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.06);
}

@media (prefers-color-scheme: dark) {
  .shortcut {
    color: var(--text-secondary, #a0aec0);
  }

  .shortcut:hover {
    color: var(--text-primary, #e0e0e0);
  }

  .shortcut-divider {
    background: rgba(51, 65, 85, 0.6);
  }

  kbd {
    color: var(--text-primary, #e0e0e0);
    background: #1e293b;
    border-color: rgba(51, 65, 85, 0.8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  kbd:hover {
    border-color: rgba(71, 85, 105, 1);
    box-shadow: 0 2px 3px rgba(0, 0, 0, 0.25);
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
