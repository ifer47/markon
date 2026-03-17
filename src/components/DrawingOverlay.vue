<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useDrawing, type Tool, type Point, type DrawAction } from '../composables/useDrawing'
import SettingsPanel from './SettingsPanel.vue'
import TextBox from './TextBox.vue'
import Icon from './Icons.vue'

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

function showToolTip(tool: Tool) {
  toolTip.value = toolLabelMap[tool] || tool
  toolTipTool.value = tool
  if (toolTipTimer) clearTimeout(toolTipTimer)
  toolTipTimer = setTimeout(() => { toolTip.value = ''; toolTipTool.value = null }, 1200)
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
  findTextAt,
  removeAction,
  undo,
  redo,
  clearAll,
  redrawAll,
  destroy,
} = useDrawing(canvasRef)

const textFontSize = computed(() => Math.max(16, lineWidth.value * 6))

const activeTextBoxColor = ref('#FF0000')
const activeTextBoxFontSize = ref(24)
const activeTextBoxInitialText = ref('')
const editingOriginalAction = ref<DrawAction | null>(null)

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

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  if (showSettings.value) return

  if (currentTool.value === 'text') {
    e.preventDefault()
    const pos = { x: e.clientX, y: e.clientY }

    const clickedTextInfo = findTextAt(pos)
    
    if (textBoxPos.value) {
      // 提交当前正在编辑的文本
      commitCurrentTextBox()
    }

    if (clickedTextInfo) {
      // 点击了已有的文本，进入编辑模式
      const { action, index } = clickedTextInfo
      editingOriginalAction.value = action
      removeAction(index)
      
      activeTextBoxColor.value = action.color
      activeTextBoxFontSize.value = action.fontSize ?? 24
      activeTextBoxInitialText.value = action.text ?? ''
      
      nextTick(() => {
        textBoxPos.value = { x: action.points[0].x, y: action.points[0].y }
      })
      return
    }

    // 点击空白处，新建文本
    activeTextBoxColor.value = currentColor.value
    activeTextBoxFontSize.value = textFontSize.value
    activeTextBoxInitialText.value = ''
    nextTick(() => {
      textBoxPos.value = pos
    })
    return
  }

  if (textBoxPos.value) {
    commitCurrentTextBox()
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

  startDraw(getPoint(e))
}

function onPointerMove(e: PointerEvent) {
  mousePos.value = { x: e.clientX, y: e.clientY }
  if (!isDrawing.value) return

  const coalesced = e.getCoalescedEvents?.()
  if (coalesced && coalesced.length > 0) {
    for (const ce of coalesced) {
      draw({ x: ce.clientX, y: ce.clientY })
    }
  } else {
    draw({ x: e.clientX, y: e.clientY })
  }
}

function onMouseUp() {
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

  if (e.key >= '1' && e.key <= '8') {
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

function getCursorStyle(): string {
  if (currentTool.value === 'eraser') return 'cell'
  if (currentTool.value === 'text') return 'text'
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
      textBoxPos.value = null
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
  destroy()
})

function exitDrawing() {
  commitCurrentTextBox()
  showSettings.value = false
  textBoxPos.value = null
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
      @pointerdown="onMouseDown"
      @pointermove="onPointerMove"
      @pointerup="onMouseUp"
      @pointerleave="onMouseUp"
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
      <div v-if="active && toolTip" class="tool-tooltip">
        <Icon v-if="toolTipTool" :name="toolTipTool" :size="18" color="#fff" />
        <span>{{ toolTip }}</span>
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
  touch-action: none;
}

.tool-tooltip {
  position: fixed;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: rgba(28, 28, 30, 0.88);
  backdrop-filter: blur(12px);
  border-radius: 10px;
  color: #fff;
  font-size: 15px;
  font-family: system-ui, sans-serif;
  letter-spacing: 0.5px;
  pointer-events: none;
  z-index: 100003;
  white-space: nowrap;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

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
</style>
