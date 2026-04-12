import { reactive } from 'vue'
import zhCN from './zh-CN'
import en from './en'

type Messages = typeof zhCN

const messages: Record<string, Messages> = { 'zh-CN': zhCN, en }

function detectLocale(): string {
  const nav = navigator.language
  if (nav.startsWith('zh')) return 'zh-CN'
  return 'en'
}

const state = reactive({
  locale: detectLocale(),
})

export function useI18n() {
  const t = (path: string, vars?: Record<string, string>): string => {
    const keys = path.split('.')
    let val: unknown = messages[state.locale] ?? messages.en
    for (const k of keys) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[k]
      else return path
    }
    let str = typeof val === 'string' ? val : path
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, v)
      }
    }
    return str
  }

  return {
    t,
    locale: state,
  }
}
