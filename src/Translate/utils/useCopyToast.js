import { ref, onUnmounted } from 'vue'
import { copyText } from './clipboard.js'

export function useCopyToast() {
  const toastVisible = ref(false)
  const toastText = ref('')
  let toastTimer = null

  const copyWithToast = async (text) => {
    try {
      await copyText(text)
      const display = text.length > 30 ? text.substring(0, 30) + '...' : text
      toastText.value = `已复制: ${display}`
      toastVisible.value = true
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        toastVisible.value = false
      }, 1500)
    } catch (e) {
      // copyText 内部已处理错误提示
    }
  }

  onUnmounted(() => clearTimeout(toastTimer))

  return { toastVisible, toastText, copyWithToast }
}
