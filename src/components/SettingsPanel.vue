<script setup lang="ts">
import type { Tool } from '../composables/useDrawing'

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

const tools: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'pen', icon: '✏️', label: '画笔', key: '1' },
  { id: 'highlighter', icon: '🖍️', label: '荧光笔', key: '2' },
  { id: 'arrow', icon: '➡️', label: '箭头', key: '3' },
  { id: 'rect', icon: '⬜', label: '矩形', key: '4' },
  { id: 'ellipse', icon: '⭕', label: '椭圆', key: '5' },
  { id: 'line', icon: '📏', label: '直线', key: '6' },
  { id: 'eraser', icon: '🧹', label: '橡皮擦', key: '7' },
]

const colors = [
  '#FF0000', '#FF6600', '#FFCC00', '#33CC33', '#0099FF',
  '#6633FF', '#FF00FF', '#FFFFFF', '#000000', '#666666',
]

const widths = [1, 2, 3, 5, 8]

function selectAndClose(tool: Tool) {
  emit('selectTool', tool)
  emit('close')
}

function pickColor(color: string) {
  emit('selectColor', color)
  emit('close')
}

function pickWidth(w: number) {
  emit('updateLineWidth', w)
  emit('close')
}

function getPanelStyle() {
  const panelW = 220
  const panelH = 260
  let left = props.x - panelW / 2
  let top = props.y - panelH / 2

  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8))
  top = Math.max(8, Math.min(top, window.innerHeight - panelH - 8))

  return { left: left + 'px', top: top + 'px' }
}
</script>

<template>
  <div class="panel-backdrop" @mousedown.self="emit('close')">
    <div class="panel" :style="getPanelStyle()">
      <div class="section-label">工具 <span class="hint">(按键 1-7 快速切换)</span></div>
      <div class="tool-grid">
        <button
          v-for="tool in tools"
          :key="tool.id"
          class="tool-btn"
          :class="{ active: currentTool === tool.id }"
          :title="`${tool.label} (${tool.key})`"
          @click="selectAndClose(tool.id)"
        >
          <span class="tool-icon">{{ tool.icon }}</span>
          <span class="tool-key">{{ tool.key }}</span>
        </button>
      </div>

      <div class="section-label">颜色</div>
      <div class="color-row">
        <button
          v-for="color in colors"
          :key="color"
          class="color-btn"
          :class="{ active: currentColor === color }"
          :style="{ backgroundColor: color }"
          @click="pickColor(color)"
        />
        <div class="custom-color-wrapper">
          <input
            type="color"
            class="custom-color-input"
            :value="currentColor"
            title="自定义颜色"
            @input="emit('selectColor', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <div class="section-label">线宽</div>
      <div class="width-row">
        <button
          v-for="w in widths"
          :key="w"
          class="width-btn"
          :class="{ active: lineWidth === w }"
          @click="pickWidth(w)"
        >
          <span
            class="width-dot"
            :style="{
              width: w * 2 + 4 + 'px',
              height: w * 2 + 4 + 'px',
              backgroundColor: currentColor,
            }"
          />
        </button>
      </div>

      <div class="shortcuts-hint">
        <span>Ctrl+拖动: 矩形</span>
        <span>Shift+拖动: 椭圆</span>
        <span>Ctrl+Shift+拖动: 箭头</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 100001;
}

.panel {
  position: absolute;
  width: 220px;
  padding: 12px;
  background: rgba(25, 25, 25, 0.95);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  user-select: none;
}

.section-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 6px;
  font-family: system-ui, sans-serif;
}

.section-label .hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
}

.tool-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.tool-btn {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.12s;
}

.tool-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.tool-btn.active {
  background: rgba(59, 130, 246, 0.5);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.6);
}

.tool-icon {
  font-size: 17px;
  line-height: 1;
}

.tool-key {
  position: absolute;
  bottom: 1px;
  right: 3px;
  font-size: 8px;
  color: rgba(255, 255, 255, 0.3);
  font-family: system-ui, sans-serif;
}

.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 12px;
}

.color-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  transition: all 0.12s;
  padding: 0;
}

.color-btn:hover {
  transform: scale(1.2);
  border-color: rgba(255, 255, 255, 0.5);
}

.color-btn.active {
  border-color: #fff;
  transform: scale(1.25);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
}

.custom-color-wrapper {
  width: 22px;
  height: 22px;
}

.custom-color-input {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 0;
  background: none;
  -webkit-appearance: none;
  appearance: none;
}

.custom-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.custom-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}

.width-row {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.width-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}

.width-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.width-btn.active {
  background: rgba(59, 130, 246, 0.4);
}

.width-dot {
  display: block;
  border-radius: 50%;
}

.shortcuts-hint {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  font-family: system-ui, sans-serif;
}
</style>
