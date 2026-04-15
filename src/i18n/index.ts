import { reactive } from 'vue'
import zhCN from './zh-CN'
import en from './en'

type Messages = typeof zhCN

const messages: Record<string, Messages> = { 'zh-CN': zhCN, en }

const LOCALE_KEY = 'markeron-locale'

function tryGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function detectLocale(): string {
  const saved = tryGetStorage(LOCALE_KEY)
  if (saved && saved in messages) return saved
  const nav = navigator.language
  if (nav.startsWith('zh')) return 'zh-CN'
  return 'en'
}

const state = reactive({
  locale: detectLocale(),
})

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY && e.newValue && e.newValue in messages) {
      state.locale = e.newValue
    }
  })
}

export function syncLocaleFromConfig(configLocale?: string) {
  if (configLocale && configLocale in messages && !tryGetStorage(LOCALE_KEY)) {
    state.locale = configLocale
  }
}

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

  const setLocale = (loc: string) => {
    if (loc in messages) {
      state.locale = loc
      localStorage.setItem(LOCALE_KEY, loc)
    }
  }

  return {
    t,
    locale: state,
    setLocale,
    availableLocales: Object.keys(messages),
  }
}
