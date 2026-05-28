export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    const displayText = text.length > 30 ? text.substring(0, 30) + '...' : text
    window.utools.showNotification(`已复制: ${displayText}`)
  } catch (err) {
    console.error('Copy failed:', err)
    window.utools.showNotification('复制失败')
  }
}
