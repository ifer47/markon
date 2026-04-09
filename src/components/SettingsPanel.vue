<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, computed, type Component } from 'vue'
import type { Tool } from '../composables/useDrawing'
import { isMacOS } from '../utils/platform'

const modKeyLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))
import {
  Pen, Highlighter, ArrowUpRight, Square, Circle,
  Minus, Eraser, Type,
} from 'lucide-vue-next'

const props = defineProps<{
  currentTool: Tool
  currentColor: string
  lineWidth: number
  x: number
  y: number
}>()

const emit = defineEmits<{
  selectTool: [tool: Tool]
  selectColor: [color: string]
  updateLineWidth: [width: number]
  close: []
}>()

const tools: { id: Tool; icon: Component; label: string; key: string }[] = [
  { id: 'pen', icon: Pen, label: '画笔', key: '1' },
  { id: 'highlighter', icon: Highlighter, label: '荧光笔', key: '2' },
  { id: 'arrow', icon: ArrowUpRight, label: '箭头', key: '3' },
  { id: 'rect', icon: Square, label: '矩形', key: '4' },
  { id: 'ellipse', icon: Circle, label: '椭圆', key: '5' },
  { id: 'line', icon: Minus, label: '直线', key: '6' },
  { id: 'eraser', icon: Eraser, label: '橡皮擦', key: '7' },
  { id: 'text', icon: Type, label: '文字', key: 'T' },
]

const colors = [
  ['#FF3B30', '#FF6B35', '#FFCC02', '#34C759', '#007AFF', '#5856D6', '#FFFFFF'],
  ['#AF52DE', '#FF2D55', '#00C7BE', '#8E8E93', '#636366', '#3A3A3C', '#000000'],
]

const widths = [
  { value: 1, label: '极细' },
  { value: 2, label: '细' },
  { value: 3, label: '中' },
  { value: 5, label: '粗' },
  { value: 8, label: '极粗' },
]

function needsWhiteCheck(ri: number, ci: number): boolean {
  return ci >= 5 || (ri === colors.length - 1 && ci >= 3)
}

const panelW = 272
const panelRef = ref<HTMLDivElement | null>(null)
const panelLeft = ref(0)
const panelTop = ref(0)
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

function initPosition() {
  nextTick(() => {
    const panelH = panelRef.value?.offsetHeight ?? 400
    let left = props.x - panelW / 2
    let top = props.y - panelH / 2
    left = Math.max(12, Math.min(left, window.innerWidth - panelW - 12))
    top = Math.max(12, Math.min(top, window.innerHeight - panelH - 12))
    panelLeft.value = left
    panelTop.value = top
  })
}

let cachedPanelH = 400
let lastDragX = 0
let lastDragY = 0
let dragRafId: number | null = null

function startDrag(e: MouseEvent) {
  isDragging.value = true
  cachedPanelH = panelRef.value?.offsetHeight ?? 400
  dragOffset.value = {
    x: e.clientX - panelLeft.value,
    y: e.clientY - panelTop.value,
  }
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  lastDragX = e.clientX
  lastDragY = e.clientY
  if (dragRafId !== null) return
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null
    panelLeft.value = Math.max(0, Math.min(lastDragX - dragOffset.value.x, window.innerWidth - panelW))
    panelTop.value = Math.max(0, Math.min(lastDragY - dragOffset.value.y, window.innerHeight - cachedPanelH))
  })
}

function stopDrag() {
  isDragging.value = false
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
}

onMounted(() => {
  initPosition()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
})
</script>

<template>
  <div class="fixed top-0 left-0 w-screen h-screen z-100001" @mousedown.self="emit('close')">
    <div
      ref="panelRef"
      class="absolute left-0 top-0 w-[272px] bg-[rgba(30,30,32,0.97)] rounded-2xl border border-white/8 shadow-[0_24px_48px_rgba(0,0,0,0.45),0_4px_16px_rgba(0,0,0,0.25),inset_0_0.5px_0_rgba(255,255,255,0.08)] select-none overflow-hidden"
      :style="{ transform: `translate3d(${panelLeft}px,${panelTop}px,0)`, willChange: isDragging ? 'transform' : 'auto' }"
      @mousedown.stop
    >
      <div class="h-2.5 cursor-default" @mousedown="startDrag" />

      <!-- 工具区 -->
      <div class="px-3.5 pt-1 pb-2.5">
        <div class="flex items-center justify-between mb-2 cursor-default" @mousedown="startDrag">
          <span class="text-[11px] font-semibold text-white/45 tracking-[0.5px] font-sans">工具</span>
          <span class="text-[10px] text-white/20 font-sans">按 1-7 / T 切换</span>
        </div>
        <div class="grid grid-cols-4 gap-1">
          <button
            v-for="tool in tools"
            :key="tool.id"
            class="flex flex-col items-center gap-[3px] pt-2 px-1 pb-1.5 border-none rounded-[10px] cursor-pointer relative transition-all duration-150"
            :class="currentTool === tool.id
              ? 'bg-accent/30 text-white shadow-[inset_0_0_0_1px_rgba(10,132,255,0.45)]'
              : 'bg-white/4 text-white/70 hover:bg-white/10 hover:text-white'"
            :title="`${tool.label} (${tool.key})`"
            @click="emit('selectTool', tool.id); emit('close')"
          >
            <component :is="tool.icon" :size="18" />
            <span class="text-[10px] leading-none font-sans">{{ tool.label }}</span>
            <span
              class="absolute top-[3px] right-[5px] text-[8px] font-sans"
              :class="currentTool === tool.id ? 'text-white/60' : 'text-white/40'"
            >{{ tool.key }}</span>
          </button>
        </div>
      </div>

      <!-- 颜色区 -->
      <div class="px-3.5 py-2.5 border-t border-white/5">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-semibold text-white/45 tracking-[0.5px] font-sans">颜色</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="(row, ri) in colors" :key="ri" class="flex justify-between">
            <button
              v-for="(color, ci) in row"
              :key="color"
              class="w-[30px] h-[30px] p-0 border-none rounded-full bg-transparent cursor-pointer relative flex items-center justify-center transition-transform duration-120"
              :class="currentColor === color ? 'scale-[1.18]' : 'hover:scale-[1.18]'"
              @click="emit('selectColor', color); emit('close')"
            >
              <span
                class="w-6 h-6 rounded-full border-2 transition-[border-color] duration-120"
                :class="currentColor === color
                  ? 'border-white/75 shadow-[0_0_0_2px_rgba(255,255,255,0.12)]'
                  : 'border-white/10'"
                :style="{ backgroundColor: color }"
              />
              <span
                v-if="currentColor === color"
                class="absolute text-[11px] font-bold pointer-events-none"
                :class="needsWhiteCheck(ri, ci)
                  ? 'text-white [text-shadow:0_0_2px_rgba(0,0,0,0.5)]'
                  : 'text-black [text-shadow:0_0_2px_rgba(255,255,255,0.5)]'"
              >✓</span>
            </button>
          </div>
        </div>
        <label class="group inline-flex items-center gap-2.5 cursor-pointer py-1.5 pl-1.5 pr-2.5 rounded-lg mt-1.5 transition-[background] duration-120 hover:bg-white/6">
          <input
            type="color"
            class="absolute w-0 h-0 opacity-0 pointer-events-none"
            :value="currentColor"
            @input="emit('selectColor', ($event.target as HTMLInputElement).value)"
          />
          <span
            class="w-[20px] h-[20px] rounded-full border border-white/20 transition-[border-color,transform] duration-120 pointer-events-none group-hover:border-white/40 group-hover:scale-105 flex items-center justify-center shadow-[inset_0_0_2px_rgba(0,0,0,0.5)]"
            style="background: conic-gradient(from 90deg, #ff0000, #ff8000, #ffff00, #80ff00, #00ff00, #00ff80, #00ffff, #0080ff, #0000ff, #8000ff, #ff00ff, #ff0080, #ff0000);"
          >
            <span class="text-white text-[14px] leading-none font-light" style="text-shadow: 0 1px 2px rgba(0,0,0,0.6)">+</span>
          </span>
          <span class="text-[11px] text-white/50 font-sans">自定义颜色</span>
        </label>
      </div>

      <!-- 线宽区 -->
      <div class="px-3.5 py-2.5 border-t border-white/5">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-semibold text-white/45 tracking-[0.5px] font-sans">线宽</span>
        </div>
        <div class="flex gap-1">
          <button
            v-for="w in widths"
            :key="w.value"
            class="group flex-1 flex items-center justify-center h-8 border-none rounded-lg cursor-pointer transition-all duration-120"
            :class="lineWidth === w.value
              ? 'bg-accent/30 shadow-[inset_0_0_0_1px_rgba(10,132,255,0.45)]'
              : 'bg-white/4 hover:bg-white/10'"
            :title="w.label"
            @click="emit('updateLineWidth', w.value); emit('close')"
          >
            <span
              class="w-[70%] rounded-full transition-transform duration-120 group-hover:scale-x-110"
              :style="{
                height: Math.max(1.5, w.value * 1.2) + 'px',
                backgroundColor: lineWidth === w.value ? '#ffffff' : 'rgba(255,255,255,0.4)',
              }"
            />
          </button>
        </div>
      </div>

      <!-- 底部快捷键提示 -->
      <div class="flex flex-col gap-1.5 pt-3 px-3.5 pb-3 border-t border-white/5">
        <div class="flex items-center justify-between text-[10.5px] font-sans">
          <span class="flex items-center gap-1.5 text-white/45">
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">{{ modKeyLabel }}</kbd>
            <span class="text-white/30 text-[10px]">+</span>
            <span>拖动</span>
          </span>
          <span class="text-white/50 text-[10.5px] text-right min-w-[48px]">矩形</span>
        </div>
        <div class="flex items-center justify-between text-[10.5px] font-sans">
          <span class="flex items-center gap-1.5 text-white/45">
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">Shift</kbd>
            <span class="text-white/30 text-[10px]">+</span>
            <span>拖动</span>
          </span>
          <span class="text-white/50 text-[10.5px] text-right min-w-[48px]">椭圆</span>
        </div>
        <div class="flex items-center justify-between text-[10.5px] font-sans">
          <span class="flex items-center gap-1.5 text-white/45">
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">{{ modKeyLabel }}</kbd>
            <span class="text-white/30 text-[10px]">+</span>
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">Shift</kbd>
            <span class="text-white/30 text-[10px]">+</span>
            <span>拖动</span>
          </span>
          <span class="text-white/50 text-[10.5px] text-right min-w-[48px]">箭头</span>
        </div>
        <div class="flex items-center justify-between text-[10.5px] font-sans">
          <span class="flex items-center gap-1.5 text-white/45">
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">Q</kbd>
            <span class="text-white/30 text-[10px]">/</span>
            <kbd class="inline-block px-1.5 py-px rounded-[4px] bg-white/10 border border-white/10 text-[9.5px] font-sans text-white/70 leading-[1.4] shadow-sm">E</kbd>
            <span class="text-white/30 text-[10px]">/</span>
            <span>右键</span>
          </span>
          <span class="text-white/50 text-[10.5px] text-right min-w-[48px]">切换颜色</span>
        </div>
      </div>
    </div>
  </div>
</template>

