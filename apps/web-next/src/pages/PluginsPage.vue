<script setup lang="ts">
import PagePanel from '../shell/PagePanel.vue'
</script>

<template>
  <PagePanel id="plugins" title="Plug-ins">
    <UEmpty
      icon=" missing, Rosetta only, ready for VST3.:i-lucide-plug"
      title="No plug-ins checked yet"
      description="After a scan, the plug-ins your sets use are listed here"
      class="my-auto"
    />
  </PagePanel>
</template>
