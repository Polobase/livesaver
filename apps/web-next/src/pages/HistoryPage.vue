<script setup lang="ts">
import PagePanel from '../shell/PagePanel.vue'
</script>

<template>
  <PagePanel id="history" title="History">
    <UEmpty
      icon="i-lucide-history"
      title="Nothing has been changed yet"
      description="Every fix is listed here with what it did, and can be undone."
      class="my-auto"
    />
  </PagePanel>
</template>
