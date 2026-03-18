<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, nextTick, computed, type Component } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useDrawing, type Tool, type DrawAction } from '../composables/useDrawing'
import SettingsPanel from './SettingsPanel.vue'
import TextBox from './TextBox.vue'
import {
  Pen, Highlighter, ArrowUpRight, Square, Circle,
  Minus, Eraser, Type,
} from 'lucide-vue-next'

const toolIconMap: Record<Tool, Component> = {
  pen: Pen,
  highlighter: Highlighter,
  arrow: ArrowUpRight,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  eraser: Eraser,
  text: Type,
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const textBoxRef = ref<InstanceType<typeof TextBox> | null>(null)
const active = ref(false)
const showSettings = ref(false)
const mousePos = ref({ x: 0, y: 0 })
const textBoxPos = ref<{ x: number; y: number } | null>(null)
const toolTip = ref('')
let toolTipTimer: ReturnType<typeof setTimeout> | null = null

const toolLabelMap: Record<Tool, string> = {
  pen: '画笔',
  highlighter: '荧光笔',
  arrow: '箭头',
  rect: '矩形',
  ellipse: '椭圆',
  line: '直线',
  eraser: '橡皮擦',
  text: '文字',
}
const toolTipTool = ref<Tool | null>(null)
const toolTipColor = ref<string | null>(null)

const showQuickColors = ref(false)
const quickColorsPos = ref({ x: 0, y: 0 })

const quickColorList = [
  '#FF3B30', '#FF6B35', '#FFCC02', '#34C759', '#007AFF', '#5856D6', '#FFFFFF',
  '#AF52DE', '#FF2D55', '#00C7BE', '#8E8E93', '#636366', '#3A3A3C', '#000000',
]

const colorNameMap: Record<string, string> = {
  '#FF3B30': '红色', '#FF6B35': '橙色', '#FFCC02': '黄色', '#34C759': '绿色',
  '#007AFF': '蓝色', '#5856D6': '紫色', '#FFFFFF': '白色', '#AF52DE': '紫罗兰',
  '#FF2D55': '粉红', '#00C7BE': '青色', '#8E8E93': '灰色', '#636366': '深灰',
  '#3A3A3C': '炭灰', '#000000': '黑色',
}

function showToolTip(tool: Tool) {
  toolTip.value = toolLabelMap[tool] || tool
  toolTipTool.value = tool
  toolTipColor.value = null
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => { toolTip.value = ''; toolTipTool.value = null; toolTipColor.value = null }, 1200)
}

function showColorTip(color: string) {
  toolTip.value = colorNameMap[color.toUpperCase()] ?? color
  toolTipTool.value = null
  toolTipColor.value = color
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => { toolTip.value = ''; toolTipTool.value = null; toolTipColor.value = null }, 1200)
}

function cycleColor(direction: number) {
  const idx = quickColorList.indexOf(currentColor.value)
  const newIdx = idx === -1 ? 0 : (idx + direction + quickColorList.length) % quickColorList.length
  currentColor.value = quickColorList[newIdx]
  showColorTip(currentColor.value)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (!active.value || showSettings.value || textBoxPos.value || isDrawing.value) return
  quickColorsPos.value = { x: e.clientX, y: e.clientY }
  showQuickColors.value = true
}

function selectQuickColor(color: string) {
  currentColor.value = color
  showQuickColors.value = false
  showColorTip(color)
}

const {
  currentTool,
  currentColor,
  lineWidth,
  isDrawing,
  startDraw,
  draw,
  endDraw,
  addTextAction,
  findActionAt,
  removeAction,
  undo,
  redo,
  clearAll,
  redrawAll,
  requestRedraw,
  beginDrag,
  endDrag,
  scheduleRender,
  destroy,
} = useDrawing(canvasRef)

const textFontSize = computed(() => Math.max(16, lineWidth.value * 6))

const activeTextBoxColor = ref('#FF0000')
const activeTextBoxFontSize = ref(24)
const activeTextBoxInitialText = ref('')
const editingOriginalAction = shallowRef<DrawAction | null>(null)

const hoveredActionInfo = shallowRef<{ action: DrawAction, index: number } | null>(null)
const isMoving = ref(false)
const moveStartPos = shallowRef<{ x: number, y: number } | null>(null)
const originalActionPoints = shallowRef<{x: number, y: number}[]>([])

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  canvas.style.width = window.innerWidth + 'px'
  canvas.style.height = window.innerHeight + 'px'

  const ctx = canvas.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)

  redrawAll()
}

let toolBeforeModifier: string | null = null

function commitCurrentTextBox(cancel = false) {
  if (textBoxRef.value && textBoxPos.value) {
    if (cancel && editingOriginalAction.value) {
      // 如果是取消编辑且有原文本，恢复原文本
      const a = editingOriginalAction.value
      addTextAction(a.text!, a.points[0].x, a.points[0].y, 0, a.fontSize!, a.color)
    } else if (!cancel) {
      const text = textBoxRef.value.getText()
      const actualFs = textBoxRef.value.getFontSize()
      if (text.trim()) {
        addTextAction(text, textBoxPos.value.x, textBoxPos.value.y, 0, actualFs, activeTextBoxColor.value)
      }
    }
    textBoxPos.value = null
    editingOriginalAction.value = null
  }
}

function onDoubleClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (showSettings.value || showQuickColors.value) return

  const pos = { x: e.clientX, y: e.clientY }
  const clickedActionInfo = findActionAt(pos)

  if (clickedActionInfo && clickedActionInfo.action.tool === 'text') {
    if (textBoxPos.value) {
      commitCurrentTextBox()
    }

    const { action, index } = clickedActionInfo
    editingOriginalAction.value = action
    removeAction(index)
    
    activeTextBoxColor.value = action.color
    activeTextBoxFontSize.value = action.fontSize ?? 24
    activeTextBoxInitialText.value = action.text ?? ''
    
    currentTool.value = 'text'
    
    nextTick(() => {
      textBoxPos.value = { x: action.points[0].x, y: action.points[0].y }
    })
  } else if (currentTool.value === 'text') {
    // 在文本模式下，双击空白处新建文本
    if (textBoxPos.value) {
      commitCurrentTextBox()
    }
    activeTextBoxColor.value = currentColor.value
    activeTextBoxFontSize.value = textFontSize.value
    activeTextBoxInitialText.value = ''
    nextTick(() => {
      textBoxPos.value = pos
    })
  }
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  if (showSettings.value || showQuickColors.value) return

  if (textBoxPos.value) {
    commitCurrentTextBox()
    return
  }

  // 优先处理拖拽，无论在什么工具模式下，只要放在已有元素上，按下就是拖拽
  if (hoveredActionInfo.value) {
    isMoving.value = true
    moveStartPos.value = { x: e.clientX, y: e.clientY }
    originalActionPoints.value = hoveredActionInfo.value.action.points.map(p => ({ ...p }))
    beginDrag(hoveredActionInfo.value.action)
    return
  }

  // 如果当前是文字模式，单击不执行任何操作（新建文字交由双击处理）
  if (currentTool.value === 'text') {
    return
  }

  if (e.ctrlKey && e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'arrow'
  } else if (e.ctrlKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'rect'
  } else if (e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'ellipse'
  }

  startDraw({ x: e.clientX, y: e.clientY })
}

function onPointerMove(e: PointerEvent) {
  mousePos.value = { x: e.clientX, y: e.clientY }

  if (isMoving.value && moveStartPos.value && hoveredActionInfo.value) {
    const dx = e.clientX - moveStartPos.value.x
    const dy = e.clientY - moveStartPos.value.y
    const action = hoveredActionInfo.value.action
    const origPoints = originalActionPoints.value
    for (let i = 0; i < action.points.length; i++) {
      action.points[i].x = origPoints[i].x + dx
      action.points[i].y = origPoints[i].y + dy
    }
    scheduleRender()
    return
  }

  if (!isDrawing.value) {
    if (active.value && !showSettings.value && !showQuickColors.value && !textBoxPos.value) {
      hoveredActionInfo.value = findActionAt(mousePos.value)
    } else {
      hoveredActionInfo.value = null
    }
    return
  }

  const isPerfect = e.altKey

  const coalesced = e.getCoalescedEvents?.()
  if (coalesced && coalesced.length > 0) {
    for (const ce of coalesced) {
      draw({ x: ce.clientX, y: ce.clientY }, isPerfect)
    }
  } else {
    draw({ x: e.clientX, y: e.clientY }, isPerfect)
  }
}

function onMouseUp() {
  if (isMoving.value) {
    isMoving.value = false
    moveStartPos.value = null
    originalActionPoints.value = []
    endDrag()
    return
  }

  endDraw()
  if (toolBeforeModifier !== null) {
    currentTool.value = toolBeforeModifier as any
    toolBeforeModifier = null
  }
}

function onTextCommit() {
  commitCurrentTextBox(false)
}

function onTextCancel() {
  commitCurrentTextBox(true)
}

function onKeyDown(e: KeyboardEvent) {
  if (!active.value) return

  // 屏蔽单独按下 Alt 键触发的系统菜单焦点（会导致光标变成默认箭头）
  if (e.key === 'Alt') {
    e.preventDefault()
  }

  if (showQuickColors.value) {
    if (e.key === 'Escape') showQuickColors.value = false
    else if (e.key === 'q' || e.key === 'Q') cycleColor(-1)
    else if (e.key === 'e' || e.key === 'E') cycleColor(1)
    else if (e.key === ' ') {
      e.preventDefault()
      mousePos.value = { ...quickColorsPos.value }
      showQuickColors.value = false
      showSettings.value = !showSettings.value
    }
    return
  }

  if (textBoxPos.value) {
    if (e.key === 'Escape') {
      commitCurrentTextBox(true)
    }
    return
  }

  if (e.key === ' ') {
    e.preventDefault()
    showSettings.value = !showSettings.value
    return
  }

  if (e.key === 'q' || e.key === 'Q') {
    cycleColor(-1)
    return
  }
  if (e.key === 'e' || e.key === 'E') {
    cycleColor(1)
    return
  }

  if (e.key === 't' || e.key === 'T') {
    currentTool.value = 'text'
    showToolTip('text')
    showSettings.value = false
    return
  }

  if (e.key >= '1' && e.key <= '7') {
    const toolMap: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser', 'text']
    const tool = toolMap[parseInt(e.key) - 1]
    currentTool.value = tool
    showToolTip(tool)
    showSettings.value = false
    return
  }

  if (showSettings.value) return

  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault()
    undo()
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault()
    redo()
  } else if (e.key === 'Delete') {
    clearAll()
  } else if (e.key === 'Escape') {
    exitDrawing()
  }
}

const cursorStyle = computed(() => {
  if (isMoving.value || (hoveredActionInfo.value && !isDrawing.value)) return 'move'
  if (currentTool.value === 'text') return 'text'
  if (showQuickColors.value || showSettings.value) return 'default'

  const c = currentColor.value
  if (currentTool.value === 'eraser') {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>` +
      `<circle cx='16' cy='16' r='14' fill='none' stroke='white' stroke-width='1.5' stroke-dasharray='3,2'/>` +
      `<line x1='16' y1='12' x2='16' y2='20' stroke='white' stroke-width='1'/>` +
      `<line x1='12' y1='16' x2='20' y2='16' stroke='white' stroke-width='1'/>` +
      `</svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`
  }

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'>` +
    `<line x1='14' y1='2' x2='14' y2='10' stroke='black' stroke-opacity='0.4' stroke-width='3' stroke-linecap='round'/>` +
    `<line x1='14' y1='18' x2='14' y2='26' stroke='black' stroke-opacity='0.4' stroke-width='3' stroke-linecap='round'/>` +
    `<line x1='2' y1='14' x2='10' y2='14' stroke='black' stroke-opacity='0.4' stroke-width='3' stroke-linecap='round'/>` +
    `<line x1='18' y1='14' x2='26' y2='14' stroke='black' stroke-opacity='0.4' stroke-width='3' stroke-linecap='round'/>` +
    `<line x1='14' y1='2' x2='14' y2='10' stroke='${c}' stroke-width='1.5' stroke-linecap='round'/>` +
    `<line x1='14' y1='18' x2='14' y2='26' stroke='${c}' stroke-width='1.5' stroke-linecap='round'/>` +
    `<line x1='2' y1='14' x2='10' y2='14' stroke='${c}' stroke-width='1.5' stroke-linecap='round'/>` +
    `<line x1='18' y1='14' x2='26' y2='14' stroke='${c}' stroke-width='1.5' stroke-linecap='round'/>` +
    `<circle cx='14' cy='14' r='2.5' fill='black' fill-opacity='0.3'/>` +
    `<circle cx='14' cy='14' r='2' fill='${c}'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, crosshair`
})

const quickColorsPanelStyle = computed(() => {
  const pw = 260, ph = 100
  let left = quickColorsPos.value.x - pw / 2
  let top = quickColorsPos.value.y - ph - 12
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
  if (top < 8) top = quickColorsPos.value.y + 12
  top = Math.max(8, Math.min(top, window.innerHeight - ph - 8))
  return { left: left + 'px', top: top + 'px' }
})

const unlisteners: UnlistenFn[] = []

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Alt') {
    e.preventDefault()
  }
}

onMounted(async () => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  unlisteners.push(
    await listen<boolean>('toggle-drawing', (event) => {
      const isActive = event.payload
      active.value = isActive
      showSettings.value = false
      showQuickColors.value = false
      textBoxPos.value = null
      clearAll()
      if (isActive) {
        currentTool.value = 'pen'
        nextTick(() => resizeCanvas())
      }
    })
  )

  unlisteners.push(
    await listen('clear-drawing', () => {
      clearAll()
    })
  )
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  unlisteners.forEach((fn) => fn())
  destroy()
})

function exitDrawing() {
  commitCurrentTextBox()
  showSettings.value = false
  showQuickColors.value = false
  textBoxPos.value = null
  invoke('exit_drawing')
}
</script>

<template>
  <div
    ref="containerRef"
    class="fixed top-0 left-0 w-screen h-screen z-99999"
    :class="active ? 'pointer-events-auto' : 'pointer-events-none'"
  >
    <canvas
      ref="canvasRef"
      class="absolute top-0 left-0 w-full h-full touch-none"
      :style="{ cursor: cursorStyle }"
      @pointerdown="onMouseDown"
      @dblclick="onDoubleClick"
      @pointermove="onPointerMove"
      @pointerup="onMouseUp"
      @pointerleave="onMouseUp"
      @contextmenu.prevent="onContextMenu"
    />

    <TextBox
      v-if="active && textBoxPos"
      ref="textBoxRef"
      :x="textBoxPos.x"
      :y="textBoxPos.y"
      :color="activeTextBoxColor"
      :font-size="activeTextBoxFontSize"
      :initial-text="activeTextBoxInitialText"
      @commit="onTextCommit"
      @cancel="onTextCancel"
    />

    <Transition name="tooltip-fade">
      <div
        v-if="active && toolTip"
        class="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 py-2 px-5 bg-[rgba(28,28,30,0.88)] backdrop-blur-md rounded-[10px] text-white text-[15px] font-sans tracking-[0.5px] pointer-events-none z-100003 whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
      >
        <span
          v-if="toolTipColor"
          class="w-4 h-4 rounded-full border border-white/20 shrink-0"
          :style="{ backgroundColor: toolTipColor }"
        />
        <component v-else-if="toolTipTool" :is="toolIconMap[toolTipTool]" :size="18" color="#fff" />
        <span>{{ toolTip }}</span>
      </div>
    </Transition>

    <!-- Quick Color Palette (right-click) -->
    <Transition name="quick-colors">
      <div
        v-if="active && showQuickColors"
        class="fixed inset-0 z-100002"
        @mousedown.self="showQuickColors = false"
        @contextmenu.prevent="showQuickColors = false"
      >
        <div
          class="absolute bg-[rgba(30,30,32,0.92)] backdrop-blur-xl rounded-xl border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-2.5 select-none"
          :style="quickColorsPanelStyle"
          @mousedown.stop
        >
          <div class="grid grid-cols-7 gap-1.5">
            <button
              v-for="color in quickColorList"
              :key="color"
              class="w-7 h-7 p-0 border-none rounded-full cursor-pointer relative flex items-center justify-center transition-transform duration-100"
              :class="currentColor === color ? 'scale-[1.2]' : 'hover:scale-[1.15]'"
              @click="selectQuickColor(color)"
            >
              <span
                class="w-[22px] h-[22px] rounded-full border-[1.5px] transition-[border-color] duration-100"
                :class="currentColor === color
                  ? 'border-white/70 shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
                  : 'border-white/10'"
                :style="{ backgroundColor: color }"
              />
              <span
                v-if="currentColor === color"
                class="absolute text-[10px] font-bold pointer-events-none"
                :class="['#FFFFFF','#FFCC02','#8E8E93'].includes(color)
                  ? 'text-black/70'
                  : 'text-white [text-shadow:0_0_2px_rgba(0,0,0,0.5)]'"
              >✓</span>
            </button>
          </div>
          <div class="flex items-center justify-center gap-3 mt-1.5 pt-1.5 border-t border-white/5">
            <span class="text-[9px] text-white/25 font-sans">Q ← 切换 → E</span>
          </div>
        </div>
      </div>
    </Transition>

    <SettingsPanel
      v-if="active && showSettings"
      :current-tool="currentTool"
      :current-color="currentColor"
      :line-width="lineWidth"
      :x="mousePos.x"
      :y="mousePos.y"
      @select-tool="(t: Tool) => { currentTool = t }"
      @select-color="(c: string) => { currentColor = c; showColorTip(c) }"
      @update-line-width="(w: number) => { lineWidth = w }"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.tooltip-fade-enter-active {
  transition: opacity 0.15s ease;
}
.tooltip-fade-leave-active {
  transition: opacity 0.4s ease;
}
.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.quick-colors-enter-active {
  transition: opacity 0.12s ease, transform 0.12s cubic-bezier(0.2, 0, 0.13, 1.5);
}
.quick-colors-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.quick-colors-enter-from {
  opacity: 0;
  transform: scale(0.9);
}
.quick-colors-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
