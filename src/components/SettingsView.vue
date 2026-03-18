<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { AppConfig, SaveResult } from '../types/app'

const activeTab = ref('shortcuts')

const tabs = [
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
  if (e.metaKey) parts.push('Super')

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
  const res = await invoke<SaveResult>('save_shortcuts', {
    shortcuts: {
      toggleDrawing: 'Ctrl+Shift+D',
      clearDrawing: 'Ctrl+Shift+C',
    },
  })
  if (res.ok) {
    shortcuts.toggleDrawing = 'Ctrl+Shift+D'
    shortcuts.clearDrawing = 'Ctrl+Shift+C'
    message.value = { type: 'success', text: '已恢复默认快捷键' }
    setTimeout(() => { message.value = null }, 3000)
  }
}

onMounted(async () => {
  const cfg = await invoke<AppConfig>('get_config')
  Object.assign(shortcuts, cfg.shortcuts)
  window.addEventListener('keydown', onKeyDown, true)
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
        <span class="text-[13px] font-semibold text-white/85 tracking-wide leading-tight">MarkOn</span>
      </div>

      <nav class="flex flex-col gap-0.5 px-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-2 px-3 py-[7px] rounded-lg text-[12.5px] border-none cursor-pointer transition-all duration-120"
          :class="activeTab === tab.id
            ? 'bg-white/10 text-white/90'
            : 'bg-transparent text-white/40 hover:bg-white/5 hover:text-white/60'"
          @click="activeTab = tab.id"
        >
          <span class="text-sm leading-none opacity-70">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </nav>

      <div class="mt-auto px-3 pb-3">
        <span class="text-[10px] text-white/12">v0.0.4</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 bg-[#1e1e20] flex flex-col overflow-hidden">
      <div v-if="activeTab === 'shortcuts'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto">
        <h2 class="text-[14px] font-semibold text-white/75 mb-0.5">快捷键</h2>
        <p class="text-[11px] text-white/25 mb-4 leading-relaxed">点击「修改」后按下新的组合键（需含 Ctrl / Alt / Shift 中至少一个），F1-F12 可单独使用</p>

        <div class="rounded-lg border border-white/5 overflow-hidden">
          <div
            v-for="(label, action, idx) in labels"
            :key="action"
            class="flex items-center justify-between px-4 py-2.5 transition-colors duration-120"
            :class="[
              capturing === action ? 'bg-accent/8' : 'hover:bg-white/3',
              idx > 0 ? 'border-t border-white/5' : '',
            ]"
          >
            <span class="text-[12.5px] text-white/55">{{ label }}</span>

            <div class="flex items-center gap-2">
              <template v-if="capturing === action">
                <span class="text-[12px] text-accent font-medium min-w-[90px] text-right tracking-wide">
                  {{ capturedKeys || '请按下组合键...' }}
                </span>
                <button
                  class="px-2 py-[3px] rounded-[5px] bg-white/6 text-white/40 text-[11px] border-none cursor-pointer hover:bg-white/10 hover:text-white/60 transition-colors duration-120"
                  @click="cancelCapture"
                >
                  取消
                </button>
              </template>
              <template v-else>
                <kbd class="inline-flex items-center px-2 py-[3px] rounded-[5px] bg-white/5 border border-white/6 text-[11px] text-white/45 font-mono tracking-wider">
                  {{ shortcuts[action] }}
                </kbd>
                <button
                  class="px-2 py-[3px] rounded-[5px] bg-white/6 text-white/40 text-[11px] border-none cursor-pointer hover:bg-white/10 hover:text-white/60 transition-colors duration-120"
                  @click="startCapture(action)"
                >
                  修改
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2.5 mt-4">
          <button
            class="px-3.5 py-[5px] rounded-[6px] bg-accent text-white text-[11.5px] font-medium border-none cursor-pointer hover:brightness-110 transition-all duration-120 disabled:opacity-40 disabled:cursor-default"
            :disabled="saving"
            @click="saveShortcuts"
          >
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button
            class="px-3.5 py-[5px] rounded-[6px] bg-white/6 text-white/40 text-[11.5px] border-none cursor-pointer hover:bg-white/10 hover:text-white/60 transition-colors duration-120"
            @click="resetDefaults"
          >
            恢复默认
          </button>
        </div>

        <!-- Message -->
        <Transition name="msg">
          <div
            v-if="message"
            class="mt-3 px-3 py-1.5 rounded-[6px] text-[11.5px]"
            :class="message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400/80'
              : 'bg-red-500/10 text-red-400/80'"
          >
            {{ message.text }}
          </div>
        </Transition>
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
