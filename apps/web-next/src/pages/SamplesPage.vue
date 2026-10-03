<script setup lang="ts">
import PagePanel from '../shell/PagePanel.vue'
</script>

<template>
  <PagePanel id="samples" title="Samples">
    <UEmpty
      icon="i-lucide-audio-waveform"
      title="No samples checked yet"
      description="After a scan, every project is listed here with what a fix would do."
      class="my-auto"
    />
  </PagePanel>
</template>
