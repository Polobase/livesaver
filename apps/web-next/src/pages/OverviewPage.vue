<script setup lang="ts">
import PagePanel from '../shell/PagePanel.vue'
</script>

<template>
  <PagePanel id="overview" title="Overview">
    <UEmpty
      icon="i-lucide-layout-dashboard"
      title="Nothing scanned yet"
      description="Scan your library to see which sets are complete, what can be fixed and what is missing."
      class="my-auto"
    />
  </PagePanel>
</template>
