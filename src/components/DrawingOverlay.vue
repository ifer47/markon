<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, nextTick, computed, watch, type Component } from 'vue'
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
  updateCursorEl(e.clientX, e.clientY)

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

// Custom cursor element ref — position updated directly in pointermove for performance
const cursorEl = ref<HTMLDivElement | null>(null)

function getCursorHotspot(): { x: number; y: number } {
  const tool = currentTool.value
  // SVG 的 viewBox 是 0 0 1024 1024。笔尖大约在 (388, 846) 的位置
  // 映射到 32x32 尺寸：x = 388/1024*32 ≈ 12， y = 846/1024*32 ≈ 26
  if (tool === 'pen') return { x: 12, y: 26 }
  if (tool === 'highlighter') return { x: 5, y: 27 } // 映射到 1024x1024 的笔尖位置(约 150, 850)
  if (tool === 'eraser') return { x: 16, y: 16 }
  return { x: 14, y: 14 }
}

function updateCursorEl(x: number, y: number) {
  if (!cursorEl.value) return
  const { x: hx, y: hy } = getCursorHotspot()
  cursorEl.value.style.transform = `translate(${x - hx}px, ${y - hy}px)`
}

// CSS cursor for the canvas: 'none' when our SVG overlay handles it
const canvasCursor = computed(() => {
  if (enableDragging.value && (isMoving.value || (hoveredActionInfo.value && !isDrawing.value))) return 'move'
  if (currentTool.value === 'text') return 'text'
  if (showQuickColors.value || showSettings.value) return 'default'
  return 'none'
})

const showCustomCursor = computed(() => active.value && canvasCursor.value === 'none' && !textBoxPos.value)

// 修复静止时按快捷键切换工具或颜色导致的光标偏心问题
watch([currentTool, currentColor], () => {
  nextTick(() => {
    if (active.value && showCustomCursor.value) {
      updateCursorEl(lastPointerX, lastPointerY)
    }
  })
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
      :style="{ cursor: canvasCursor }"
      @pointerdown="onPointerDown"
      @dblclick="onDoubleClick"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @contextmenu.prevent="onContextMenu"
      @wheel="onWheel"
    />

    <!-- Custom cursor element: SVG rendered in DOM, positioned via transform -->
    <div
      v-show="showCustomCursor"
      ref="cursorEl"
      class="fixed top-0 left-0 pointer-events-none select-none drop-shadow-md"
      style="z-index: 100010; will-change: transform"
    >
      <!-- 画笔: 使用用户提供的自定义 SVG 图标 -->
      <svg
        v-if="currentTool === 'pen'"
        width="32"
        height="32"
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; overflow: visible; filter: drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.3))"
      >
        <g transform="rotate(15 388 846)">
          <path d="M482.9 279.5L357.6 694.1l45.3 152.5 121.9-102L650 330z" fill="#FFDCB3"></path>
          <path d="M490.435 254.311l167.144 50.477L532.37 719.395l-167.145-50.477z" fill="#FECD44"></path>
          <path d="M388.3 797.1l14.6 49.5 39.6-33.1z" fill="#AEABA8"></path>
          <path d="M402.9 846.6l66.2-118.8 23.9-37.4 31.8 54.2z" fill="#CC9D71"></path>
          <!-- 笔尖：绑定 currentColor，让它显示当前绘制的颜色 -->
          <path d="M424.4 808.1l-21.5 38.5 39.6-33.1z" :fill="currentColor"></path>
          <path d="M413.4 710.9l-10.5 135.7 66.2-118.8 0.6-53.3-38.6 5.2z" fill="#F0BF92"></path>
          <!-- 笔身蓝色条纹：原本是蓝色，我们也把它改成动态颜色以增强辨识度 -->
          <path
            d="M413.4 710.9s-9-15.2-24.4-19.9c-15.4-4.7-31.3 3.1-31.3 3.1l125.2-414.6 55.7 16.8-125.2 414.6z"
            :fill="currentColor"
            opacity="0.6"
          ></path>
          <path
            d="M469.1 727.8s-8.5-15.1-24.4-19.9c-15.9-4.8-31.3 3.1-31.3 3.1l125.2-414.6 55.7 16.8-125.2 414.6z"
            :fill="currentColor"
            opacity="0.8"
          ></path>
          <path
            d="M524.8 744.6s-9.9-15.5-24.4-19.9-31.3 3.1-31.3 3.1l125.2-414.6L650 330 524.8 744.6z"
            :fill="currentColor"
          ></path>
          <path d="M406.3 802.6l-3.4 44 21.5-38.5z" fill="#63585B"></path>
          <!-- 笔帽：绑定 currentColor，改变颜色时跟随变化 -->
          <path
            d="M650 330l-167.1-50.5 12.1-40c13.9-46.2 62.7-72.3 108.8-58.3 46.2 13.9 72.3 62.6 58.3 108.8L650 330z"
            :fill="currentColor"
          ></path>
          <!-- 笔帽和笔身之间的分割线：默认白色，如果是白色画笔则变黑，同时增加 1px 厚度 -->
          <g
            :fill="currentColor.toUpperCase() === '#FFFFFF' ? '#333333' : '#FFFFFF'"
            :stroke="currentColor.toUpperCase() === '#FFFFFF' ? '#333333' : '#FFFFFF'"
            stroke-width="32"
            stroke-linejoin="round"
          >
            <path d="M481.713 251.694l184.663 55.767-7.603 25.177-184.663-55.767z"></path>
            <path d="M474.075 276.876l7.604-25.177 61.554 18.589-7.603 25.177z"></path>
            <path d="M535.656 295.425l7.603-25.177 61.554 18.59-7.603 25.176z"></path>
          </g>
          <path
            d="M637.3 227.1c7.8 11.9 10.2 24.1 12.2 22.8s2.9-15.7-5-27.6c-7.8-11.9-21.3-16.8-23.3-15.5-1.9 1.3 8.3 8.4 16.1 20.3z"
            fill="#FFFFFF"
          ></path>
          <path d="M533.7 312.5l4.9-16.2-55.7-16.8-7.4 24.2z" fill="#7898E3"></path>
          <path d="M591.8 321.2l2.5-8.1-55.7-16.8-4.9 16.2z" fill="#3463D9"></path>
          <path d="M650 330l-55.7-16.9-2.5 8.1z" fill="#1A46AB"></path>
        </g>
      </svg>

      <!-- 荧光笔: 使用用户提供的自定义 SVG 图标 -->
      <svg
        v-else-if="currentTool === 'highlighter'"
        width="32"
        height="32"
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; overflow: visible; filter: drop-shadow(1px 2px 3px rgba(0, 0, 0, 0.3))"
      >
        <path
          d="M312.32 829.013333a4.266667 4.266667 0 0 0 4.778667-0.853333l40.106666-40.106667a4.266667 4.266667 0 0 0 0-6.016l-114.602666-114.645333a4.266667 4.266667 0 0 0-6.016 0l-83.2 83.114667a4.266667 4.266667 0 0 0 1.28 6.912l157.653333 71.68v-0.042667z m220.288-382.208a32 32 0 0 0 45.226667 45.226667l162.474666-162.432a32 32 0 0 0-45.226666-45.269333l-162.474667 162.474666z"
          :fill="currentColor"
        ></path>
        <path
          d="M384.426667 748.8a40.533333 40.533333 0 0 0 57.301333 0l77.312-77.269333a10.666667 10.666667 0 0 1 3.114667-2.133334l97.450666-44.714666c8.021333-3.712 15.36-8.789333 21.674667-15.061334l231.893333-231.893333a74.666667 74.666667 0 0 0 0-105.6L752.512 151.466667a74.666667 74.666667 0 0 0-105.6 0L415.018667 383.36a74.666667 74.666667 0 0 0-15.061334 21.674667l-44.672 97.450666a10.666667 10.666667 0 0 1-2.133333 3.114667l-77.354667 77.312a40.533333 40.533333 0 0 0 0 57.301333l108.629334 108.629334v-0.042667z m89.386666-122.538667L413.013333 686.976l-75.434666-75.434667 60.714666-60.714666a74.666667 74.666667 0 0 0 15.061334-21.674667l44.672-97.450667a10.666667 10.666667 0 0 1 2.133333-3.114666l231.893333-231.850667a10.666667 10.666667 0 0 1 15.104 0l120.661334 120.661333a10.666667 10.666667 0 0 1 0 15.104l-231.850667 231.850667a10.666667 10.666667 0 0 1-3.114667 2.133333l-97.450666 44.714667a74.794667 74.794667 0 0 0-21.674667 15.061333z"
          :fill="currentColor"
          opacity="0.8"
        ></path>
      </svg>
      <!-- 橡皮擦: 虚线圆 + 十字 -->
      <svg
        v-else-if="currentTool === 'eraser'"
        width="32"
        height="32"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block"
      >
        <circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1.5" stroke-dasharray="3 2" />
        <line x1="16" y1="12" x2="16" y2="20" stroke="white" stroke-width="1" />
        <line x1="12" y1="16" x2="20" y2="16" stroke="white" stroke-width="1" />
      </svg>
      <!-- 箭头/矩形/椭圆/直线: 彩色十字准星 -->
      <svg v-else width="28" height="28" xmlns="http://www.w3.org/2000/svg" style="display: block">
        <line
          x1="14"
          y1="2"
          x2="14"
          y2="10"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="14"
          y1="18"
          x2="14"
          y2="26"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="2"
          y1="14"
          x2="10"
          y2="14"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="18"
          y1="14"
          x2="26"
          y2="14"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line x1="14" y1="2" x2="14" y2="10" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="14" y1="18" x2="14" y2="26" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="2" y1="14" x2="10" y2="14" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="18" y1="14" x2="26" y2="14" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="14" cy="14" r="2.5" fill="black" fill-opacity="0.3" />
        <circle cx="14" cy="14" r="2" :fill="currentColor" />
      </svg>
    </div>

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
