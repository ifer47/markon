<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { isMacOS } from '../utils/platform'
import { useI18n } from '../i18n'

const { t } = useI18n()

const props = defineProps<{
  x: number
  y: number
  color: string
  fontSize: number
  initialText?: string
}>()

const emit = defineEmits<{
  commit: [text: string, x: number, y: number, width: number, fontSize: number]
  cancel: []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fs = ref(props.fontSize)

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  el.style.width = 'auto'
  el.style.width = Math.max(4, el.scrollWidth + 4) + 'px'
}

onMounted(() => {
  if (props.initialText && textareaRef.value) {
    textareaRef.value.value = props.initialText
  }
  autoResize()
  const el = textareaRef.value
  if (!el) return
  el.focus()
  requestAnimationFrame(() => {
    el.focus()
  })
})

function getText(): string {
  return textareaRef.value?.value ?? ''
}

function commitText() {
  const text = getText()
  emit('commit', text, props.x, props.y, 0, fs.value)
}

function onKeyDown(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  }
  if (e.key === 'Enter' && (e.ctrlKey || (isMacOS() && e.metaKey))) {
    e.preventDefault()
    commitText()
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  e.stopPropagation()
  const step = e.deltaY < 0 ? 2 : -2
  fs.value = Math.max(12, Math.min(120, fs.value + step))
  nextTick(autoResize)
}

function getFontSize(): number {
  return fs.value
}

defineExpose({ commitText, getText, getFontSize })
</script>

<template>
  <textarea
    ref="textareaRef"
    class="fixed left-0 top-0 z-100002 px-0.5 py-0 border-none bg-transparent outline-none resize-none font-text overflow-hidden whitespace-pre min-w-[4px] max-w-[80vw] placeholder:text-white/25"
    :style="{
      transform: `translate(${x}px, ${y - Math.round(fs * 1.3) / 2}px)`,
      color: color,
      fontSize: fs + 'px',
      lineHeight: Math.round(fs * 1.3) + 'px',
      minHeight: Math.round(fs * 1.3) + 'px',
      caretColor: color,
    }"
    :placeholder="t('textBox.placeholder')"
    spellcheck="false"
    @keydown="onKeyDown"
    @input="autoResize"
    @mousedown.stop
    @wheel="onWheel"
  />
</template>

