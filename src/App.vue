<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DrawingOverlay from './components/DrawingOverlay.vue'
import SettingsView from './components/SettingsView.vue'

const mode = ref<'overlay' | 'settings'>('overlay')

onMounted(() => {
  if (window.location.hash === '#settings') {
    mode.value = 'settings'
    document.documentElement.classList.add('settings')
  }
})
</script>

<template>
  <SettingsView v-if="mode === 'settings'" />
  <DrawingOverlay v-else />
</template>
