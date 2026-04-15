<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart'
import type { AppConfig, SaveResult } from '../types/app'
import { isMacOS } from '../utils/platform'
import { useI18n, syncLocaleFromConfig } from '../i18n'

const { t, locale, setLocale, availableLocales } = useI18n()

const localeLabels: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

const localeOpen = ref(false)
const localeDropdownRef = ref<HTMLElement | null>(null)

async function changeLocale(loc: string) {
  localeOpen.value = false
  if (loc === locale.locale) return
  setLocale(loc)
  try {
    await invoke('save_locale', { locale: loc })
  } catch (error) {
    console.error('Failed to save locale:', error)
  }
}

function toggleLocaleDropdown() {
  localeOpen.value = !localeOpen.value
  if (localeOpen.value) {
    nextTick(() => {
      document.addEventListener('click', closeLocaleDropdown, { once: true })
    })
  }
}

function closeLocaleDropdown(e: MouseEvent) {
  if (localeDropdownRef.value && !localeDropdownRef.value.contains(e.target as Node)) {
    localeOpen.value = false
  } else if (localeOpen.value) {
    nextTick(() => {
      document.addEventListener('click', closeLocaleDropdown, { once: true })
    })
  }
}

const modLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))

const defaultShortcutStrings = computed(() =>
  isMacOS()
    ? { toggleDrawing: 'Command+Shift+D', clearDrawing: 'Command+Shift+C' }
    : { toggleDrawing: 'Ctrl+Shift+D', clearDrawing: 'Ctrl+Shift+C' },
)

const hashTab = window.location.hash.split('/')[1]
const activeTab = ref(hashTab && ['general', 'shortcuts', 'help', 'about'].includes(hashTab) ? hashTab : 'general')

const APP_VERSION = __APP_VERSION__

const tabIds = ['general', 'shortcuts', 'help', 'about'] as const
const tabs = computed(() => tabIds.map((id) => ({ id, label: t(`settings.tabs.${id}`) })))

const shortcuts = reactive<AppConfig['shortcuts']>({
  toggleDrawing: '',
  clearDrawing: '',
})

const labels = computed<Record<keyof AppConfig['shortcuts'], string>>(() => ({
  toggleDrawing: t('settings.shortcutLabels.toggleDrawing'),
  clearDrawing: t('settings.shortcutLabels.clearDrawing'),
}))

const capturing = ref<keyof AppConfig['shortcuts'] | null>(null)
const capturedKeys = ref('')
const saving = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

const keyMap: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
}

function startCapture(action: keyof AppConfig['shortcuts']) {
  capturing.value = action
  capturedKeys.value = ''
  message.value = null
}

function cancelCapture() {
  capturing.value = null
  capturedKeys.value = ''
}

function onKeyDown(e: KeyboardEvent) {
  if (!capturing.value) return
  e.preventDefault()
  e.stopPropagation()

  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey

  if (e.key === 'Escape' && !hasMod) {
    cancelCapture()
    return
  }

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push(isMacOS() ? 'Command' : 'Super')

  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) {
    capturedKeys.value = parts.join('+') + '+...'
    return
  }

  const isF = /^F(\d{1,2})$/.test(k)
  if (!hasMod && !isF) return

  let name = k.length === 1 ? k.toUpperCase() : k
  if (keyMap[name]) name = keyMap[name]
  parts.push(name)

  const result = parts.join('+')
  capturedKeys.value = result
  shortcuts[capturing.value] = result
  capturing.value = null
  saveShortcuts()
}

async function saveShortcuts() {
  saving.value = true
  message.value = null
  try {
    const res = await invoke<SaveResult>('save_shortcuts', { shortcuts: { ...shortcuts } })
    if (res.ok) {
      message.value = { type: 'success', text: t('settings.shortcutsSaved') }
    } else {
      message.value = {
        type: 'error',
        text: t('settings.shortcutsConflict', { keys: res.failed?.join(', ') ?? '' }),
      }
      const cfg = await invoke<AppConfig>('get_config')
      Object.assign(shortcuts, cfg.shortcuts)
    }
  } catch {
    message.value = { type: 'error', text: t('settings.saveFailed') }
  } finally {
    saving.value = false
    setTimeout(() => {
      message.value = null
    }, 3000)
  }
}

async function resetDefaults() {
  const d = defaultShortcutStrings.value
  const res = await invoke<SaveResult>('save_shortcuts', {
    shortcuts: {
      toggleDrawing: d.toggleDrawing,
      clearDrawing: d.clearDrawing,
    },
  })
  if (res.ok) {
    shortcuts.toggleDrawing = d.toggleDrawing
    shortcuts.clearDrawing = d.clearDrawing
    message.value = { type: 'success', text: t('settings.restoredDefaults') }
    setTimeout(() => {
      message.value = null
    }, 3000)
  }
}

const autoStartEnabled = ref(false)
const enableDragging = ref(false)

async function toggleAutoStart() {
  try {
    if (autoStartEnabled.value) {
      await disable()
    } else {
      await enable()
    }
    autoStartEnabled.value = await isEnabled()
  } catch (error) {
    console.error('Failed to toggle auto start:', error)
  }
}

async function openUrl(url: string) {
  await invoke('open_url', { url })
}

async function toggleDragging() {
  enableDragging.value = !enableDragging.value
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general) cfg.general = { enableDragging: false }
    cfg.general.enableDragging = enableDragging.value
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save drag setting:', error)
  }
}

let unlistenSwitchTab: (() => void) | null = null

onMounted(async () => {
  const cfg = await invoke<AppConfig>('get_config')
  Object.assign(shortcuts, cfg.shortcuts)
  enableDragging.value = cfg.general?.enableDragging ?? false
  syncLocaleFromConfig(cfg.general?.locale)
  window.addEventListener('keydown', onKeyDown, true)

  unlistenSwitchTab = await listen<string>('switch-tab', (e) => {
    activeTab.value = e.payload
  })

  try {
    autoStartEnabled.value = await isEnabled()
  } catch (error) {
    console.error('Failed to check auto start status:', error)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  unlistenSwitchTab?.()
})
</script>

<template>
  <div class="flex h-screen w-screen font-text text-white select-none overflow-hidden">
    <!-- Sidebar -->
    <div class="w-[154px] shrink-0 bg-[#161618] flex flex-col border-r border-white/5">
      <div class="flex items-center gap-2.5 px-4 pt-5 pb-5">
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M659.498667 412.8l-6.101334-6.058667a233.6 233.6 0 0 0-101.973333-57.557333c-124.032-33.237333-243.157333 37.077333-276.992 163.413333-1.834667 6.826667-2.816 14.506667-4.437333 33.749334-6.570667 79.786667-25.344 139.306667-76.8 199.68 96.426667 37.888 210.688 64.597333 297.557333 64.597333a234.88 234.88 0 0 0 226.56-174.037333 234.538667 234.538667 0 0 0-57.856-223.786667z m-92.501334-147.712l210.730667-163.925333a42.666667 42.666667 0 0 1 56.32 3.541333l127.786667 127.744a42.666667 42.666667 0 0 1 3.498666 56.32l-163.84 210.730667a320.213333 320.213333 0 0 1-310.741333 396.458666C341.333333 895.957333 149.333333 831.872 42.666667 767.872c169.813333-128 130.005333-205.226667 149.333333-277.333333 45.141333-168.533333 206.592-267.008 374.997333-225.450667zM712.533333 345.258667c2.816 2.688 5.546667 5.461333 8.277334 8.234666L769.28 401.92l105.6-135.765333-74.496-74.496-135.765333 105.6L712.533333 345.258667z"
            fill="currentColor"
          />
        </svg>
        <span class="text-[13px] font-semibold text-white/85 tracking-wide leading-tight">MarkerOn</span>
      </div>

      <nav class="flex flex-col gap-0.5 px-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="relative flex items-center gap-2 px-3 py-[7px] rounded-lg text-[12.5px] border-none cursor-pointer transition-all duration-120 overflow-hidden"
          :class="
            activeTab === tab.id
              ? 'bg-white/10 text-white/90'
              : 'bg-transparent text-white/40 hover:bg-white/5 hover:text-white/60'
          "
          @click="activeTab = tab.id"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3.5 bg-accent rounded-r-md"
          ></div>
          <svg
            v-if="tab.id === 'general'"
            class="w-[14px] h-[14px] shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <svg
            v-else-if="tab.id === 'shortcuts'"
            class="w-[14px] h-[14px] shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
          </svg>
          <svg
            v-else-if="tab.id === 'help'"
            class="w-[14px] h-[14px] shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <svg
            v-else-if="tab.id === 'about'"
            class="w-[14px] h-[14px] shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          {{ tab.label }}
        </button>
      </nav>

      <div class="mt-auto"></div>
    </div>

    <!-- Content -->
    <div class="flex-1 bg-[#1e1e20] flex flex-col overflow-hidden">
      <div v-if="activeTab === 'shortcuts'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto">
        <div class="flex items-center gap-2 mb-4">
          <h2 class="text-[14px] font-semibold text-white/75">{{ t('settings.shortcutsTitle') }}</h2>
          <div class="group relative flex items-center">
            <svg
              class="w-[14px] h-[14px] text-white/30 cursor-help hover:text-white/60 transition-colors duration-200 outline-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <div
              class="absolute left-full top-1/2 -translate-y-1/2 ml-2 mt-4 w-[248px] p-2.5 bg-[#2a2a2c] border border-white/10 rounded-[8px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] opacity-0 scale-95 invisible group-hover:opacity-100 group-hover:scale-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none origin-left"
            >
              <p class="text-[10.5px] text-white/75 leading-[1.6] m-0 text-left font-sans">
                {{ t('settings.comboRequirement', { mod: modLabel }) }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="(label, action) in labels"
            :key="action"
            class="flex items-center justify-between px-4 py-3.5 rounded-lg border transition-all duration-200"
            :class="[
              capturing === action
                ? 'border-accent/50 bg-accent/5 shadow-[0_0_0_1px_rgba(10,132,255,0.2)]'
                : 'border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10',
            ]"
          >
            <span class="text-[12.5px] text-white/70">{{ label }}</span>

            <div class="flex items-center gap-2">
              <template v-if="capturing === action">
                <span class="text-[12px] text-accent font-medium min-w-[90px] text-right tracking-wide">
                  {{ capturedKeys || t('settings.pressComboHint') }}
                </span>
                <button
                  class="px-2.5 py-[4px] rounded-md bg-white/10 text-white/60 text-[11px] border border-white/10 cursor-pointer hover:bg-white/20 hover:text-white transition-colors duration-120"
                  @click="cancelCapture"
                >
                  {{ t('settings.cancel') }}
                </button>
              </template>
              <template v-else>
                <kbd
                  class="inline-flex items-center px-2 py-[3px] rounded-[5px] bg-white/5 border border-white/10 text-[11px] text-white/50 font-mono tracking-wider shadow-sm"
                >
                  {{ shortcuts[action] }}
                </kbd>
                <button
                  class="px-2.5 py-[4px] rounded-md bg-white/10 text-white/70 text-[11px] border border-white/10 cursor-pointer hover:bg-white/20 hover:text-white transition-colors duration-120 shadow-sm"
                  @click="startCapture(action)"
                >
                  {{ t('settings.edit') }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between mt-4">
          <!-- Message -->
          <div class="min-h-[32px] flex items-center">
            <Transition name="msg">
              <div
                v-if="message"
                class="px-3 py-1.5 rounded-[6px] text-[11.5px]"
                :class="
                  message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400/80' : 'bg-red-500/10 text-red-400/80'
                "
              >
                {{ message.text }}
              </div>
            </Transition>
          </div>

          <button
            class="px-3.5 py-[5px] rounded-[6px] bg-white/4 border border-white/10 text-white/60 text-[11.5px] cursor-pointer hover:bg-white/10 hover:text-white transition-all duration-120 shadow-sm ml-auto"
            @click="resetDefaults"
          >
            {{ t('settings.restoreDefaults') }}
          </button>
        </div>
      </div>

      <div v-else-if="activeTab === 'general'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto">
        <h2 class="text-[14px] font-semibold text-white/75 mb-4">{{ t('settings.generalTitle') }}</h2>

        <div class="flex flex-col gap-2">
          <div
            class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
          >
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] text-white/70">{{ t('settings.language') }}</span>
              <div ref="localeDropdownRef" class="relative">
                <button
                  class="flex items-center gap-1.5 px-3 py-[5px] rounded-md bg-white/6 border border-white/8 text-[12px] text-white/75 cursor-pointer outline-none hover:bg-white/10 hover:border-white/15 transition-all duration-150"
                  @click="toggleLocaleDropdown"
                >
                  {{ localeLabels[locale.locale] || locale.locale }}
                  <svg
                    class="w-3 h-3 text-white/35 transition-transform duration-150"
                    :class="localeOpen ? 'rotate-180' : ''"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <Transition name="dropdown">
                  <div
                    v-if="localeOpen"
                    class="absolute right-0 top-full mt-1 min-w-[120px] py-1 rounded-lg bg-[#2a2a2c] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
                  >
                    <button
                      v-for="loc in availableLocales"
                      :key="loc"
                      class="w-full flex items-center gap-2 px-3 py-[6px] text-[12px] border-none cursor-pointer transition-colors duration-100"
                      :class="
                        locale.locale === loc
                          ? 'bg-accent/12 text-accent'
                          : 'bg-transparent text-white/65 hover:bg-white/8 hover:text-white/90'
                      "
                      @click="changeLocale(loc)"
                    >
                      <svg
                        v-if="locale.locale === loc"
                        class="w-3 h-3 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span v-else class="w-3 shrink-0"></span>
                      {{ localeLabels[loc] || loc }}
                    </button>
                  </div>
                </Transition>
              </div>
            </div>

            <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
              {{ t('settings.languageDesc') }}
            </p>
          </div>

          <div
            class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
          >
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] text-white/70">{{ t('settings.autoStart') }}</span>
              <button
                class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
                :class="autoStartEnabled ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
                @click="toggleAutoStart"
              >
                <span
                  class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
                  :class="autoStartEnabled ? 'translate-x-[14px]' : 'translate-x-0'"
                />
              </button>
            </div>

            <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
              {{ t('settings.autoStartDesc') }}
            </p>
          </div>

          <div
            class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
          >
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] text-white/70">{{ t('settings.enableDragging') }}</span>
              <button
                class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
                :class="enableDragging ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
                @click="toggleDragging"
              >
                <span
                  class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
                  :class="enableDragging ? 'translate-x-[14px]' : 'translate-x-0'"
                />
              </button>
            </div>

            <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
              {{ t('settings.enableDraggingDesc') }}
            </p>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'help'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto help-scroll">
        <h2 class="text-[14px] font-semibold text-white/75 mb-4">{{ t('help.basicUsage') }}</h2>

        <div class="flex flex-col gap-2">
          <!-- Intro card -->
          <div class="help-card">
            <div class="px-4 py-3 text-[11.5px] text-white/50 leading-[1.8]">
              <p class="m-0" v-html="t('help.basicDesc1')" />
              <p class="m-0 mt-1" v-html="t('help.basicDesc2')" />
            </div>
          </div>

          <!-- Global shortcuts -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.globalShortcuts') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.toggleAnnotation') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Shift+D</kbd><span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘+⇧+D</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.clearAll') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Shift+C</kbd><span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘+⇧+C</kbd>
                </div>
              </div>
            </div>
          </div>

          <!-- Tool switch -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.toolSwitch') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">1</kbd><span class="ml-2.5">{{ t('tools.pen') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.pen') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">2</kbd><span class="ml-2.5">{{ t('tools.highlighter') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.highlighter') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">3</kbd><span class="ml-2.5">{{ t('tools.arrow') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.arrow') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">4</kbd><span class="ml-2.5">{{ t('tools.rect') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.rect') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">5</kbd><span class="ml-2.5">{{ t('tools.ellipse') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.ellipse') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">6</kbd><span class="ml-2.5">{{ t('tools.line') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.line') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">7</kbd><span class="ml-2.5">{{ t('tools.eraser') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.eraser') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label"
                  ><kbd class="help-kbd">T</kbd><span class="ml-2.5">{{ t('tools.text') }}</span></span
                >
                <span class="help-desc">{{ t('toolDesc.text') }}</span>
              </div>
            </div>
          </div>

          <!-- Modifier drawing -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.modifierDraw') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.straightLine') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Alt</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⌥</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.rect') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.square') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Alt</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘+⌥</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.ellipse') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Shift</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⇧</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.circle') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Shift+Alt</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⇧+⌥</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.arrow') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Shift</kbd> + {{ t('panel.drag') }}<span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘+⇧</kbd> + {{ t('panel.drag') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Color & edit operations -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.colorSwitch') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label"><kbd class="help-kbd">Q</kbd> / <kbd class="help-kbd">E</kbd></span>
                <span class="help-desc">{{ t('help.prevColor') }} / {{ t('help.nextColor') }}</span>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.mouseRightClick') }}</span>
                <span class="help-desc">{{ t('help.rightClickColor') }}</span>
              </div>
            </div>
          </div>

          <!-- Edit & other -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.editAndOther') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.settingsPanel') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Space</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.copyScreen') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+C</kbd><span class="help-sep">/</span><kbd class="help-kbd">⌘+C</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.undo') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Z</kbd><span class="help-sep">/</span><kbd class="help-kbd">⌘+Z</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.redo') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl+Shift+Z</kbd><span class="help-sep">/</span
                  ><kbd class="help-kbd">⌘+⇧+Z</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.strokeWidth') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">Ctrl</kbd> + Scroll<span class="help-sep">/</span><kbd class="help-kbd">⌘</kbd>
                  + Scroll
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.clearAllAnnotation') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Delete</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.exitAnnotation') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Esc</kbd></div>
              </div>
            </div>
          </div>

          <!-- Drag & text -->
          <div class="help-card">
            <div class="help-card-header">{{ t('help.dragAndText') }}</div>
            <div class="help-rows">
              <div class="help-row help-row-block">
                <span class="help-label text-white/60">{{ t('help.dragElement') }}</span>
                <span class="help-desc">{{ t('help.dragDesc') }}</span>
              </div>
              <div class="help-row help-row-block">
                <span class="help-label text-white/60">{{ t('help.editText') }}</span>
                <span class="help-desc"><span v-html="t('help.editTextDesc')" /></span>
              </div>
              <div class="help-row help-row-block">
                <span class="help-label text-white/60">{{ t('help.confirmText') }}</span>
                <span class="help-desc"><span v-html="t('help.confirmTextDesc')" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'about'" class="flex-1 flex flex-col items-center px-7 py-8 overflow-y-auto">
        <!-- Icon -->
        <div
          class="w-16 h-16 rounded-2xl bg-linear-to-br from-accent/20 to-accent/5 flex items-center justify-center mb-4 shadow-lg shadow-accent/5 border border-accent/10"
        >
          <svg class="w-8 h-8 text-accent" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M659.498667 412.8l-6.101334-6.058667a233.6 233.6 0 0 0-101.973333-57.557333c-124.032-33.237333-243.157333 37.077333-276.992 163.413333-1.834667 6.826667-2.816 14.506667-4.437333 33.749334-6.570667 79.786667-25.344 139.306667-76.8 199.68 96.426667 37.888 210.688 64.597333 297.557333 64.597333a234.88 234.88 0 0 0 226.56-174.037333 234.538667 234.538667 0 0 0-57.856-223.786667z m-92.501334-147.712l210.730667-163.925333a42.666667 42.666667 0 0 1 56.32 3.541333l127.786667 127.744a42.666667 42.666667 0 0 1 3.498666 56.32l-163.84 210.730667a320.213333 320.213333 0 0 1-310.741333 396.458666C341.333333 895.957333 149.333333 831.872 42.666667 767.872c169.813333-128 130.005333-205.226667 149.333333-277.333333 45.141333-168.533333 206.592-267.008 374.997333-225.450667zM712.533333 345.258667c2.816 2.688 5.546667 5.461333 8.277334 8.234666L769.28 401.92l105.6-135.765333-74.496-74.496-135.765333 105.6L712.533333 345.258667z"
              fill="currentColor"
            />
          </svg>
        </div>

        <!-- Name & Version -->
        <h1 class="text-[18px] font-semibold text-white/85 tracking-wide mb-1">MarkerOn</h1>
        <span class="text-[12px] text-white/30 font-mono tracking-wider mb-1.5">v{{ APP_VERSION }}</span>
        <p class="text-[11.5px] text-white/40 mb-6">{{ t('about.tagline') }}</p>

        <!-- Info Card -->
        <div class="w-full max-w-[340px] rounded-xl border border-white/5 bg-white/2 overflow-hidden">
          <div
            class="flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/3 transition-colors"
          >
            <span class="text-[12px] text-white/45">{{ t('about.author') }}</span>
            <span class="text-[12px] text-white/65">ifer47</span>
          </div>
          <div
            class="flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/3 transition-colors"
          >
            <span class="text-[12px] text-white/45">{{ t('about.license') }}</span>
            <span class="text-[12px] text-white/65">MIT License</span>
          </div>
          <button
            class="w-full flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-x-0 border-t-0"
            @click="openUrl('https://github.com/ifer47/markeron')"
          >
            <span class="text-[12px] text-white/45">GitHub</span>
            <span class="flex items-center gap-1.5 text-[12px] text-accent/70">
              ifer47/markeron
              <svg
                class="w-3 h-3 opacity-50"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </span>
          </button>
          <button
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-none"
            @click="openUrl('https://github.com/ifer47/markeron/issues')"
          >
            <span class="text-[12px] text-white/45">{{ t('about.feedback') }}</span>
            <svg
              class="w-3.5 h-3.5 text-white/25"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <!-- Footer -->
        <p class="mt-auto pt-6 text-[10.5px] text-white/20 tracking-wide">&copy; 2026 ifer47 &middot; Open Source</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-enter-active,
.msg-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.help-scroll::-webkit-scrollbar {
  width: 4px;
}

.help-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.help-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.help-card {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.help-card:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}

.help-card-header {
  padding: 7px 14px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  letter-spacing: 0.03em;
}

.help-rows {
  display: flex;
  flex-direction: column;
}

.help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  min-height: 30px;
  gap: 12px;
}

.help-row:last-child {
  border-bottom: none;
}

.help-row-block {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 14px;
}

.help-label {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.help-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  text-align: right;
}

.help-row-block .help-desc {
  text-align: left;
}

.help-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  white-space: nowrap;
  flex-shrink: 0;
}

.help-sep {
  color: rgba(255, 255, 255, 0.15);
  margin: 0 2px;
  font-size: 10px;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}

.help-kbd {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  white-space: nowrap;
}
</style>
