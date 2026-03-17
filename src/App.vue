<script setup lang="ts">
import DrawingOverlay from './components/DrawingOverlay.vue'
</script>

<template>
  <DrawingOverlay />
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent !important;
}
#app {
  width: 100vw;
  height: 100vh;
  background: transparent;
}
</style>
