<script setup lang="ts">
/**
 * How Live's own content gets onto the page, step by step and in pictures. Where it lies
 * depends on the computer: inside the app on a Mac, in a hidden folder on Windows.
 */
import { platform } from '../../lib/platform'
import { liveGuideOpen } from '../../shell/guide'
import ScrollRegion from '../common/ScrollRegion.vue'
import LiveGuideMac from './LiveGuideMac.vue'
import LiveGuideWindows from './LiveGuideWindows.vue'
</script>

<template>
  <UModal
    v-model:open="liveGuideOpen"
    title="Adding Live’s own content"
    :description="platform.liveGuide"
    :ui="{
      content: 'sm:max-w-2xl',
      body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0',
    }"
  >
    <template #body>
      <!-- (Longer than a small window is high: it scrolls, with the keyboard too.) -->
      <ScrollRegion label="Adding Live’s own content" class="p-4 sm:p-6">
        <LiveGuideWindows v-if="platform.windows" />
        <LiveGuideMac v-else />
      </ScrollRegion>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="subtle"
        label="Got it"
        data-testid="guide-close"
        @click="liveGuideOpen = false"
      />
    </template>
  </UModal>
</template>
