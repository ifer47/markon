<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart'
import type { AppConfig, SaveResult } from '../types/app'
import { isMacOS } from '../utils/platform'

const modLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))

const defaultShortcutStrings = computed(() =>
  isMacOS()
    ? { toggleDrawing: 'Command+Shift+D', clearDrawing: 'Command+Shift+C' }
    : { toggleDrawing: 'Ctrl+Shift+D', clearDrawing: 'Ctrl+Shift+C' },
)

const activeTab = ref('general')

const tabs = [
  { id: 'general', label: '常规', icon: '⚙' },
  { id: 'shortcuts', label: '快捷键', icon: '⌨' },
]

const shortcuts = reactive<AppConfig['shortcuts']>({
  toggleDrawing: '',
  clearDrawing: '',
})

const labels: Record<keyof AppConfig['shortcuts'], string> = {
  toggleDrawing: '开始标注',
  clearDrawing: '清除标注',
}

const capturing = ref<keyof AppConfig['shortcuts'] | null>(null)
const capturedKeys = ref('')
const saving = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

const keyMap: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  ' ': 'Space', AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute',
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
      message.value = { type: 'success', text: '快捷键已保存' }
    } else {
      message.value = {
        type: 'error',
        text: `以下快捷键被占用：${res.failed?.join('、') ?? ''}`,
      }
      const cfg = await invoke<AppConfig>('get_config')
      Object.assign(shortcuts, cfg.shortcuts)
    }
  } catch {
    message.value = { type: 'error', text: '保存失败，请重试' }
  } finally {
    saving.value = false
    setTimeout(() => { message.value = null }, 3000)
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
    message.value = { type: 'success', text: '已恢复默认快捷键' }
    setTimeout(() => { message.value = null }, 3000)
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

onMounted(async () => {
  const cfg = await invoke<AppConfig>('get_config')
  Object.assign(shortcuts, cfg.shortcuts)
  enableDragging.value = cfg.general?.enableDragging ?? false
  window.addEventListener('keydown', onKeyDown, true)
  
  try {
    autoStartEnabled.value = await isEnabled()
  } catch (error) {
    console.error('Failed to check auto start status:', error)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true)
})
</script>

<template>
  <div class="flex h-screen w-screen font-text text-white select-none overflow-hidden">
    <!-- Sidebar -->
    <div class="w-[154px] shrink-0 bg-[#161618] flex flex-col border-r border-white/5">
      <div class="flex items-center gap-2.5 px-4 pt-5 pb-5">
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M659.498667 412.8l-6.101334-6.058667a233.6 233.6 0 0 0-101.973333-57.557333c-124.032-33.237333-243.157333 37.077333-276.992 163.413333-1.834667 6.826667-2.816 14.506667-4.437333 33.749334-6.570667 79.786667-25.344 139.306667-76.8 199.68 96.426667 37.888 210.688 64.597333 297.557333 64.597333a234.88 234.88 0 0 0 226.56-174.037333 234.538667 234.538667 0 0 0-57.856-223.786667z m-92.501334-147.712l210.730667-163.925333a42.666667 42.666667 0 0 1 56.32 3.541333l127.786667 127.744a42.666667 42.666667 0 0 1 3.498666 56.32l-163.84 210.730667a320.213333 320.213333 0 0 1-310.741333 396.458666C341.333333 895.957333 149.333333 831.872 42.666667 767.872c169.813333-128 130.005333-205.226667 149.333333-277.333333 45.141333-168.533333 206.592-267.008 374.997333-225.450667zM712.533333 345.258667c2.816 2.688 5.546667 5.461333 8.277334 8.234666L769.28 401.92l105.6-135.765333-74.496-74.496-135.765333 105.6L712.533333 345.258667z" fill="currentColor"/></svg>
        <span class="text-[13px] font-semibold text-white/85 tracking-wide leading-tight">MarkerOn</span>
      </div>

      <nav class="flex flex-col gap-0.5 px-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="relative flex items-center gap-2 px-3 py-[7px] rounded-lg text-[12.5px] border-none cursor-pointer transition-all duration-120 overflow-hidden"
          :class="activeTab === tab.id
            ? 'bg-white/10 text-white/90'
            : 'bg-transparent text-white/40 hover:bg-white/5 hover:text-white/60'"
          @click="activeTab = tab.id"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3.5 bg-accent rounded-r-md"
          ></div>
          <span class="text-sm leading-none opacity-70">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </nav>

      <div class="mt-auto px-4 pb-4">
        <span class="text-[11px] text-white/30 font-mono tracking-wider">v0.1.1</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 bg-[#1e1e20] flex flex-col overflow-hidden">
      <div v-if="activeTab === 'shortcuts'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto">
        <div class="flex items-center gap-2 mb-4">
          <h2 class="text-[14px] font-semibold text-white/75">快捷键</h2>
          <div class="group relative flex items-center">
            <svg class="w-[14px] h-[14px] text-white/30 cursor-help hover:text-white/60 transition-colors duration-200 outline-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <div class="absolute left-full top-1/2 -translate-y-1/2 ml-2 mt-4 w-[248px] p-2.5 bg-[#2a2a2c] border border-white/10 rounded-[8px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] opacity-0 scale-95 invisible group-hover:opacity-100 group-hover:scale-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none origin-left">
              <p class="text-[10.5px] text-white/75 leading-[1.6] m-0 text-left font-sans">
                点击「修改」后按下新的组合键（需含 {{ modLabel }} / Alt / Shift 中至少一个），F1-F12 可单独使用。
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
                : 'border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10'
            ]"
          >
            <span class="text-[12.5px] text-white/70">{{ label }}</span>

            <div class="flex items-center gap-2">
              <template v-if="capturing === action">
                <span class="text-[12px] text-accent font-medium min-w-[90px] text-right tracking-wide">
                  {{ capturedKeys || '请按下组合键...' }}
                </span>
                <button
                  class="px-2.5 py-[4px] rounded-md bg-white/10 text-white/60 text-[11px] border border-white/10 cursor-pointer hover:bg-white/20 hover:text-white transition-colors duration-120"
                  @click="cancelCapture"
                >
                  取消
                </button>
              </template>
              <template v-else>
                <kbd class="inline-flex items-center px-2 py-[3px] rounded-[5px] bg-white/5 border border-white/10 text-[11px] text-white/50 font-mono tracking-wider shadow-sm">
                  {{ shortcuts[action] }}
                </kbd>
                <button
                  class="px-2.5 py-[4px] rounded-md bg-white/10 text-white/70 text-[11px] border border-white/10 cursor-pointer hover:bg-white/20 hover:text-white transition-colors duration-120 shadow-sm"
                  @click="startCapture(action)"
                >
                  修改
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
                :class="message.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400/80'
                  : 'bg-red-500/10 text-red-400/80'"
              >
                {{ message.text }}
              </div>
            </Transition>
          </div>

          <button
            class="px-3.5 py-[5px] rounded-[6px] bg-white/4 border border-white/10 text-white/60 text-[11.5px] cursor-pointer hover:bg-white/10 hover:text-white transition-all duration-120 shadow-sm ml-auto"
            @click="resetDefaults"
          >
            恢复默认
          </button>
        </div>
      </div>

      <div v-else-if="activeTab === 'general'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto">
        <h2 class="text-[14px] font-semibold text-white/75 mb-4">常规</h2>

        <div class="flex flex-col gap-2">
          <div class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200">
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] text-white/70">开机自动启动</span>
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
              开启后，应用程序会在系统启动时自动在后台静默运行。
            </p>
          </div>

          <div class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200">
            <div class="flex items-center justify-between">
              <span class="text-[12.5px] text-white/70">允许拖拽已有元素</span>
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
              开启后，可以通过鼠标拖动已经绘制的图形和文字。
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-enter-active,
.msg-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
