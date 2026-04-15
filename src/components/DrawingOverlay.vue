<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, nextTick, computed, type Component } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useDrawing, type Tool, type DrawAction } from '../composables/useDrawing'
import type { AppConfig } from '../types/app'
import SettingsPanel from './SettingsPanel.vue'
import TextBox from './TextBox.vue'
import { Pen, Highlighter, ArrowUpRight, Square, Circle, Minus, Eraser, Type } from '@lucide/vue'
import { isMacOS } from '../utils/platform'
import { useI18n } from '../i18n'

const { t } = useI18n()

function modDown(e: PointerEvent | KeyboardEvent): boolean {
  return e.ctrlKey || (isMacOS() && e.metaKey)
}

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

const historyCanvasRef = ref<HTMLCanvasElement | null>(null)
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const textBoxRef = ref<InstanceType<typeof TextBox> | null>(null)
const active = ref(false)
const showSettings = ref(false)
const mousePos = ref({ x: 0, y: 0 })
const textBoxPos = ref<{ x: number; y: number } | null>(null)
const toolTip = ref('')
let toolTipTimer: ReturnType<typeof setTimeout> | null = null

const toolLabelMap = computed<Record<Tool, string>>(() => ({
  pen: t('tools.pen'),
  highlighter: t('tools.highlighter'),
  arrow: t('tools.arrow'),
  rect: t('tools.rect'),
  ellipse: t('tools.ellipse'),
  line: t('tools.line'),
  eraser: t('tools.eraser'),
  text: t('tools.text'),
}))
const toolTipTool = ref<Tool | null>(null)
const toolTipColor = ref<string | null>(null)
const toolTipWidth = ref<number | null>(null)

const showQuickColors = ref(false)
const quickColorsPos = ref({ x: 0, y: 0 })

const quickColorList = [
  '#FF3B30',
  '#FF6B35',
  '#FFCC02',
  '#34C759',
  '#007AFF',
  '#5856D6',
  '#FFFFFF',
  '#AF52DE',
  '#FF2D55',
  '#00C7BE',
  '#8E8E93',
  '#636366',
  '#3A3A3C',
  '#000000',
]

const colorNameMap = computed<Record<string, string>>(() => ({
  '#FF3B30': t('colors.#FF3B30'),
  '#FF6B35': t('colors.#FF6B35'),
  '#FFCC02': t('colors.#FFCC02'),
  '#34C759': t('colors.#34C759'),
  '#007AFF': t('colors.#007AFF'),
  '#5856D6': t('colors.#5856D6'),
  '#FFFFFF': t('colors.#FFFFFF'),
  '#AF52DE': t('colors.#AF52DE'),
  '#FF2D55': t('colors.#FF2D55'),
  '#00C7BE': t('colors.#00C7BE'),
  '#8E8E93': t('colors.#8E8E93'),
  '#636366': t('colors.#636366'),
  '#3A3A3C': t('colors.#3A3A3C'),
  '#000000': t('colors.#000000'),
}))

function showToolTip(tool: Tool) {
  toolTip.value = toolLabelMap.value[tool] || tool
  toolTipTool.value = tool
  toolTipColor.value = null
  toolTipWidth.value = null
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => {
    toolTip.value = ''
    toolTipTool.value = null
    toolTipColor.value = null
    toolTipWidth.value = null
  }, 1200)
}

function showColorTip(color: string) {
  toolTip.value = colorNameMap.value[color.toUpperCase()] ?? color
  toolTipTool.value = null
  toolTipColor.value = color
  toolTipWidth.value = null
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => {
    toolTip.value = ''
    toolTipTool.value = null
    toolTipColor.value = null
    toolTipWidth.value = null
  }, 1200)
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

const WIDTH_PRESETS = [1, 2, 3, 5, 8]

function onWheel(e: WheelEvent) {
  if (!active.value || !e.ctrlKey) return
  const tool = currentTool.value
  if (tool === 'highlighter' || tool === 'eraser') return
  e.preventDefault()
  const dir = e.deltaY < 0 ? 1 : -1
  const idx = WIDTH_PRESETS.indexOf(lineWidth.value)
  const cur =
    idx !== -1
      ? idx
      : Math.max(
          0,
          WIDTH_PRESETS.findIndex((v) => v >= lineWidth.value),
        )
  const next = Math.max(0, Math.min(WIDTH_PRESETS.length - 1, cur + dir))
  lineWidth.value = WIDTH_PRESETS[next]
  const labelKey = tool === 'text' ? `textSizes.${lineWidth.value}` : `widths.${lineWidth.value}`
  showWidthTip(lineWidth.value, t(labelKey))
}

const {
  currentTool,
  currentColor,
  lineWidth,
  isDrawing,
  startDraw,
  draw,
  drawBatch,
  endDraw,
  addTextAction,
  findActionAt,
  removeAction,
  undo,
  redo,
  clearAll,
  hardReset,
  redrawAll,
  beginDrag,
  updateDragOffset,
  endDrag,
  destroy,
} = useDrawing(historyCanvasRef, previewCanvasRef)

const textFontSize = computed(() => Math.max(16, lineWidth.value * 6))

const activeTextBoxColor = ref('#FF0000')
const activeTextBoxFontSize = ref(24)
const activeTextBoxInitialText = ref('')
const editingOriginalAction = shallowRef<DrawAction | null>(null)

function setSettingsVisible(visible: boolean) {
  if (showSettings.value === visible) return
  showSettings.value = visible
}

function toggleSettingsVisible() {
  setSettingsVisible(!showSettings.value)
}

const hoveredActionInfo = shallowRef<{ action: DrawAction; index: number } | null>(null)
const isMoving = ref(false)
const enableDragging = ref(false)
let hoverRafId: number | null = null
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let lastPointerX = 0
let lastPointerY = 0

// Cap total canvas bitmap pixels to keep drawImage / clearRect fast on
// high-resolution displays with low scale factors (e.g. 4K @ 150% → 2560×1440
// CSS viewport, 8.3M bitmap pixels). The budget is set so that typical laptop
// displays (e.g. 2880×1800 @ 200%) are unaffected.
const MAX_CANVAS_PIXELS = 6_000_000

function getEffectiveDpr(): number {
  const rawDpr = window.devicePixelRatio || 1
  const cssW = window.innerWidth
  const cssH = window.innerHeight
  const rawPixels = cssW * rawDpr * cssH * rawDpr
  if (rawPixels <= MAX_CANVAS_PIXELS) return rawDpr
  return Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)))
}

function resizeCanvas() {
  const historyCanvas = historyCanvasRef.value
  const previewCanvas = previewCanvasRef.value
  if (!historyCanvas || !previewCanvas) return

  const dpr = getEffectiveDpr()
  for (const canvas of [historyCanvas, previewCanvas]) {
    canvas.width = Math.round(window.innerWidth * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
    canvas.style.width = window.innerWidth + 'px'
    canvas.style.height = window.innerHeight + 'px'
  }

  redrawAll()
}

let toolBeforeModifier: string | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let dprMediaQuery: MediaQueryList | null = null

function debouncedResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(resizeCanvas, 100)
}

function watchDpr() {
  dprMediaQuery?.removeEventListener('change', onDprChange)
  dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprMediaQuery.addEventListener('change', onDprChange)
}

function onDprChange() {
  debouncedResize()
  watchDpr()
}

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

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if (showSettings.value || showQuickColors.value) return

  lastPointerX = e.clientX
  lastPointerY = e.clientY

  if (textBoxPos.value) {
    commitCurrentTextBox()
    return
  }

  // 优先处理拖拽，无论在什么工具模式下，只要放在已有元素上，按下就是拖拽
  if (hoveredActionInfo.value && enableDragging.value) {
    isDragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    isMoving.value = true
    beginDrag(hoveredActionInfo.value.action)
    previewCanvasRef.value?.setPointerCapture(e.pointerId)
    return
  }

  // 如果当前是文字模式，单击不执行任何操作（新建文字交由双击处理）
  if (currentTool.value === 'text') {
    return
  }

  if (modDown(e) && e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'arrow'
  } else if (modDown(e)) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'rect'
  } else if (e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'ellipse'
  } else if (e.altKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'line'
  }

  previewCanvasRef.value?.setPointerCapture(e.pointerId)
  startDraw({ x: e.clientX, y: e.clientY })
}

function onPointerMove(e: PointerEvent) {
  lastPointerX = e.clientX
  lastPointerY = e.clientY

  if (isDragging) {
    updateDragOffset(e.clientX - dragStartX, e.clientY - dragStartY)
    return
  }

  if (!isDrawing.value) {
    mousePos.value.x = e.clientX
    mousePos.value.y = e.clientY

    if (active.value && !showSettings.value && !showQuickColors.value && !textBoxPos.value && enableDragging.value) {
      if (hoverRafId === null) {
        hoverRafId = requestAnimationFrame(() => {
          hoverRafId = null
          if (
            active.value &&
            !showSettings.value &&
            !showQuickColors.value &&
            !textBoxPos.value &&
            enableDragging.value
          ) {
            hoveredActionInfo.value = findActionAt(mousePos.value)
          }
        })
      }
    } else {
      hoveredActionInfo.value = null
    }
    return
  }

  const isPerfect = e.altKey

  const coalesced = e.getCoalescedEvents?.()
  if (coalesced && coalesced.length > 0) {
    drawBatch(coalesced, isPerfect)
  } else {
    draw({ x: e.clientX, y: e.clientY }, isPerfect)
  }
}

function onPointerUp(e: PointerEvent) {
  previewCanvasRef.value?.releasePointerCapture(e.pointerId)

  if (isDragging) {
    isDragging = false
    isMoving.value = false
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
      toggleSettingsVisible()
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
    mousePos.value = { x: lastPointerX, y: lastPointerY }
    toggleSettingsVisible()
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
    setSettingsVisible(false)
    return
  }

  if (e.key >= '1' && e.key <= '7') {
    const toolMap: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser', 'text']
    const tool = toolMap[parseInt(e.key) - 1]
    currentTool.value = tool
    showToolTip(tool)
    setSettingsVisible(false)
    return
  }

  if (modDown(e) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    copyScreen()
    return
  }

  if (showSettings.value) return

  if (modDown(e) && e.shiftKey && e.key === 'Z') {
    e.preventDefault()
    redo()
  } else if (modDown(e) && e.key === 'z') {
    e.preventDefault()
    undo()
  } else if (modDown(e) && e.key === 'y') {
    e.preventDefault()
    redo()
  } else if (e.key === 'Delete') {
    clearAll()
  } else if (e.key === 'Escape') {
    exitDrawing()
  }
}

const cursorSvgCache = new Map<string, string>()

const cursorStyle = computed(() => {
  if (enableDragging.value && (isMoving.value || (hoveredActionInfo.value && !isDrawing.value))) return 'move'
  if (currentTool.value === 'text') return 'text'
  if (showQuickColors.value || showSettings.value) return 'default'

  const c = currentColor.value
  const isEraser = currentTool.value === 'eraser'
  const key = isEraser ? 'eraser' : c

  const cached = cursorSvgCache.get(key)
  if (cached) return cached

  let result: string
  if (isEraser) {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>` +
      `<circle cx='16' cy='16' r='14' fill='none' stroke='white' stroke-width='1.5' stroke-dasharray='3,2'/>` +
      `<line x1='16' y1='12' x2='16' y2='20' stroke='white' stroke-width='1'/>` +
      `<line x1='12' y1='16' x2='20' y2='16' stroke='white' stroke-width='1'/>` +
      `</svg>`
    result = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`
  } else {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'>` +
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
    result = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, crosshair`
  }

  cursorSvgCache.set(key, result)
  return result
})

const quickColorsPanelStyle = computed(() => {
  const pw = 260,
    ph = 100
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
  window.addEventListener('resize', debouncedResize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  watchDpr()

  // Fetch initial config
  try {
    const cfg = await invoke<AppConfig>('get_config')
    enableDragging.value = cfg.general?.enableDragging ?? false
  } catch (error) {
    console.error('Failed to get initial config:', error)
  }

  // Listen to config changes
  unlisteners.push(
    await listen<AppConfig>('config-changed', (event) => {
      enableDragging.value = event.payload.general?.enableDragging ?? false
    }),
  )

  unlisteners.push(
    await listen<boolean>('toggle-drawing', (event) => {
      const isActive = event.payload
      active.value = isActive
      showSettings.value = false
      showQuickColors.value = false
      textBoxPos.value = null
      hardReset()
      if (isActive) {
        currentTool.value = 'pen'
        nextTick(() => resizeCanvas())
      }
    }),
  )

  unlisteners.push(
    await listen('clear-drawing', () => {
      hardReset()
    }),
  )
})

onUnmounted(() => {
  window.removeEventListener('resize', debouncedResize)
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
  dprMediaQuery?.removeEventListener('change', onDprChange)
  dprMediaQuery = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (hoverRafId !== null) {
    cancelAnimationFrame(hoverRafId)
    hoverRafId = null
  }
  unlisteners.forEach((fn) => fn())
  destroy()
})

let isCopying = false

async function copyScreen() {
  if (isCopying) return
  isCopying = true
  try {
    await invoke('copy_screen')
    showTip(t('overlay.copiedToClipboard'))
  } catch (err) {
    console.error('Copy screen failed:', err)
    showTip(t('overlay.copyFailed'))
  } finally {
    isCopying = false
  }
}

function showTip(text: string) {
  toolTip.value = text
  toolTipTool.value = null
  toolTipColor.value = null
  toolTipWidth.value = null
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => {
    toolTip.value = ''
    toolTipTool.value = null
    toolTipColor.value = null
    toolTipWidth.value = null
  }, 1500)
}

function showWidthTip(w: number, label?: string) {
  const resolved = t(`widths.${w}`)
  toolTip.value = label ?? (resolved !== `widths.${w}` ? resolved : `${w}px`)
  toolTipTool.value = null
  toolTipColor.value = null
  toolTipWidth.value = w
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => {
    toolTip.value = ''
    toolTipTool.value = null
    toolTipColor.value = null
    toolTipWidth.value = null
  }, 1200)
}

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
      ref="historyCanvasRef"
      class="absolute top-0 left-0 w-full h-full pointer-events-none"
      style="contain: strict"
    />
    <canvas
      ref="previewCanvasRef"
      class="absolute top-0 left-0 w-full h-full touch-none"
      style="contain: strict"
      :style="{ cursor: cursorStyle }"
      @pointerdown="onPointerDown"
      @dblclick="onDoubleClick"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @contextmenu.prevent="onContextMenu"
      @wheel="onWheel"
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
        class="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 py-2 px-5 bg-[rgba(28,28,30,0.94)] rounded-[10px] text-white text-[15px] font-sans tracking-[0.5px] pointer-events-none z-100003 whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
      >
        <span
          v-if="toolTipColor"
          class="w-4 h-4 rounded-full border border-white/20 shrink-0"
          :style="{ backgroundColor: toolTipColor }"
        />
        <span
          v-else-if="toolTipWidth"
          class="shrink-0 rounded-full bg-white"
          :style="{ width: '20px', height: Math.max(1.5, toolTipWidth * 1.2) + 'px' }"
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
          class="absolute bg-[rgba(30,30,32,0.97)] rounded-xl border border-white/8 shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-2.5 select-none"
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
                :class="
                  currentColor === color
                    ? 'border-white/70 shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
                    : 'border-white/10'
                "
                :style="{ backgroundColor: color }"
              />
              <span
                v-if="currentColor === color"
                class="absolute text-[10px] font-bold pointer-events-none"
                :class="
                  ['#FFFFFF', '#FFCC02', '#8E8E93'].includes(color)
                    ? 'text-black/70'
                    : 'text-white [text-shadow:0_0_2px_rgba(0,0,0,0.5)]'
                "
                >✓</span
              >
            </button>
          </div>
          <div class="flex items-center justify-center gap-3 mt-1.5 pt-1.5 border-t border-white/5">
            <span class="text-[10px] text-white/50 font-sans tracking-wider">{{ t('panel.colorSwitch') }}</span>
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
      @select-tool="
        (tool: Tool) => {
          currentTool = tool
        }
      "
      @select-color="
        (color: string) => {
          currentColor = color
          showColorTip(color)
        }
      "
      @update-line-width="
        (w: number) => {
          lineWidth = w
        }
      "
      @close="setSettingsVisible(false)"
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
  transition:
    opacity 0.12s ease,
    transform 0.12s cubic-bezier(0.2, 0, 0.13, 1.5);
}
.quick-colors-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
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
