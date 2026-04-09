/** True when running in a macOS environment (Tauri webview or Safari-like UA). */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const p = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(p) || /Mac OS/i.test(ua)
}
