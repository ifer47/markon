<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useDrawing, type Tool, type Point } from '../composables/useDrawing'
import SettingsPanel from './SettingsPanel.vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const active = ref(false)
const showSettings = ref(false)
const mousePos = ref({ x: 0, y: 0 })

const {
  currentTool,
  currentColor,
  lineWidth,
  isDrawing,
  startDraw,
  draw,
  endDraw,
  undo,
  redo,
  clearAll,
  redrawAll,
} = useDrawing(canvasRef)

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

function getPoint(e: MouseEvent): Point {
  return { x: e.clientX, y: e.clientY }
}

let toolBeforeModifier: string | null = null

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  if (showSettings.value) return

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

  startDraw(getPoint(e))
}

function onMouseMove(e: MouseEvent) {
  mousePos.value = { x: e.clientX, y: e.clientY }
  draw(getPoint(e))
}

function onMouseUp() {
  endDraw()
  if (toolBeforeModifier !== null) {
    currentTool.value = toolBeforeModifier as any
    toolBeforeModifier = null
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (!active.value) return

  if (e.key === ' ') {
    e.preventDefault()
    showSettings.value = !showSettings.value
    return
  }

  if (e.key >= '1' && e.key <= '7') {
    const toolMap: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser']
    currentTool.value = toolMap[parseInt(e.key) - 1]
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

function getCursorStyle(): string {
  if (currentTool.value === 'eraser') return 'cell'
  return 'crosshair'
}

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('keydown', onKeyDown)

  if (window.electronAPI) {
    window.electronAPI.onToggleDrawing((isActive: boolean) => {
      active.value = isActive
      showSettings.value = false
      clearAll()
      if (isActive) {
        nextTick(() => resizeCanvas())
      }
    })

    window.electronAPI.onClearDrawing(() => {
      clearAll()
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('keydown', onKeyDown)
})

function exitDrawing() {
  showSettings.value = false
  if (window.electronAPI) {
    window.electronAPI.exitDrawing()
  }
}
</script>

<template>
  <div
    ref="containerRef"
    class="drawing-overlay"
    :class="{ active }"
  >
    <canvas
      ref="canvasRef"
      class="drawing-canvas"
      :style="{ cursor: getCursorStyle() }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
    />

    <SettingsPanel
      v-if="active && showSettings"
      :current-tool="currentTool"
      :current-color="currentColor"
      :line-width="lineWidth"
      :x="mousePos.x"
      :y="mousePos.y"
      @select-tool="(t: Tool) => { currentTool = t }"
      @select-color="(c: string) => { currentColor = c }"
      @update-line-width="(w: number) => { lineWidth = w }"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.drawing-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 99999;
}

.drawing-overlay.active {
  pointer-events: auto;
}

.drawing-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>
