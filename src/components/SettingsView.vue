<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import type { AppConfig } from '../types/electron'

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
    const res = await window.electronAPI.saveShortcuts({ ...shortcuts })
    if (res.ok) {
      message.value = { type: 'success', text: '快捷键已保存' }
    } else {
      message.value = {
        type: 'error',
        text: `以下快捷键被占用：${res.failed?.join('、') ?? ''}`,
      }
      const cfg = await window.electronAPI.getConfig()
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
  const res = await window.electronAPI.saveShortcuts({
    toggleDrawing: 'Ctrl+Shift+D',
    clearDrawing: 'Ctrl+Shift+C',
  })
  if (res.ok) {
    shortcuts.toggleDrawing = 'Ctrl+Shift+D'
    shortcuts.clearDrawing = 'Ctrl+Shift+C'
    message.value = { type: 'success', text: '已恢复默认快捷键' }
    setTimeout(() => { message.value = null }, 3000)
  }
}

onMounted(async () => {
  const cfg = await window.electronAPI.getConfig()
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
    <div class="w-[160px] shrink-0 bg-[#161618] flex flex-col border-r border-white/5">
      <div class="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <img src="/icon.png" class="w-8 h-8 rounded-lg" alt="MarkOn" draggable="false" />
        <span class="text-[13px] font-semibold text-white/80 tracking-wide">MarkOn</span>
      </div>

      <nav class="flex flex-col gap-0.5 px-2 mt-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] border-none cursor-pointer transition-all duration-120"
          :class="activeTab === tab.id
            ? 'bg-white/10 text-white'
            : 'bg-transparent text-white/50 hover:bg-white/5 hover:text-white/70'"
          @click="activeTab = tab.id"
        >
          <span class="text-base leading-none">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </nav>

      <div class="mt-auto px-3 pb-4">
        <span class="text-[10px] text-white/15">v0.0.2</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 bg-[#1e1e20] flex flex-col overflow-hidden">
      <div v-if="activeTab === 'shortcuts'" class="flex-1 flex flex-col px-6 py-5 overflow-y-auto">
        <h2 class="text-[15px] font-semibold text-white/80 mb-1">快捷键设置</h2>
        <p class="text-[11px] text-white/30 mb-5">点击「修改」后按下新的快捷键组合，需包含至少一个修饰键（Ctrl / Alt / Shift），F1-F12 可单独使用</p>

        <div class="flex flex-col gap-2">
          <div
            v-for="(label, action) in labels"
            :key="action"
            class="flex items-center justify-between px-4 py-3 rounded-xl transition-colors duration-120"
            :class="capturing === action ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-white/3 hover:bg-white/5'"
          >
            <span class="text-[13px] text-white/70">{{ label }}</span>

            <div class="flex items-center gap-2.5">
              <template v-if="capturing === action">
                <span class="text-[13px] text-accent font-medium min-w-[100px] text-right">
                  {{ capturedKeys || '请按下组合键...' }}
                </span>
                <button
                  class="px-2.5 py-1 rounded-md bg-white/8 text-white/50 text-[11px] border-none cursor-pointer hover:bg-white/12 hover:text-white/70 transition-colors duration-120"
                  @click="cancelCapture"
                >
                  取消
                </button>
              </template>
              <template v-else>
                <kbd class="inline-flex items-center px-2.5 py-1 rounded-md bg-white/6 border border-white/8 text-[12px] text-white/60 font-mono tracking-wide">
                  {{ shortcuts[action] }}
                </kbd>
                <button
                  class="px-2.5 py-1 rounded-md bg-white/8 text-white/50 text-[11px] border-none cursor-pointer hover:bg-white/12 hover:text-white/70 transition-colors duration-120"
                  @click="startCapture(action)"
                >
                  修改
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 mt-5">
          <button
            class="px-4 py-[7px] rounded-lg bg-accent text-white text-[12px] font-medium border-none cursor-pointer hover:brightness-110 transition-all duration-120 disabled:opacity-40 disabled:cursor-default"
            :disabled="saving"
            @click="saveShortcuts"
          >
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button
            class="px-4 py-[7px] rounded-lg bg-white/8 text-white/50 text-[12px] border-none cursor-pointer hover:bg-white/12 hover:text-white/70 transition-colors duration-120"
            @click="resetDefaults"
          >
            恢复默认
          </button>
        </div>

        <!-- Message -->
        <Transition name="msg">
          <div
            v-if="message"
            class="mt-3 px-3 py-2 rounded-lg text-[12px]"
            :class="message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
              : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'"
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
