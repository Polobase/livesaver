<script setup lang="ts">
/** The plug-ins in three numbers: not installed, Rosetta only, and what can become VST3. */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, plural } from '../../lib/format'

const props = defineProps<{ scan: Scan }>()
const view = computed(() => props.scan.plugins)
const counts = computed(() => view.value.counts)
</script>

<template>
  <UCard data-testid="plugins-card">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex items-center gap-2 text-sm font-medium text-muted">
        <UIcon name="i-lucide-plug" class="size-4" />
        Plug-ins
      </div>
      <p class="text-sm" data-testid="plugins-used">
        Your sets use
        <span class="font-semibold text-highlighted">{{ plural(counts.used, 'plug-in') }}</span>
        <template v-if="!view.inventory">; whether they are installed is not known here.</template>
        <template v-else>.</template>
      </p>
      <dl v-if="view.inventory" class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-triangle-alert" class="size-4 text-(--status-missing)" />
          <dt class="text-muted">Not installed</dt>
          <dd class="tabular font-medium text-highlighted">{{ count(counts.missing) }}</dd>
        </div>
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-cpu" class="size-4 text-(--status-fixable)" />
          <dt class="text-muted">Rosetta only</dt>
          <dd class="tabular font-medium text-highlighted">{{ count(counts.rosetta) }}</dd>
        </div>
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-circle-arrow-up" class="size-4 text-muted" />
          <dt class="text-muted">Can be upgraded to VST3</dt>
          <dd class="tabular font-medium text-highlighted">{{ count(counts.vst3Verified) }}</dd>
        </div>
      </dl>
      <UButton
        to="/plugins"
        class="ms-auto"
        color="neutral"
        variant="subtle"
        trailing-icon="i-lucide-arrow-right"
        label="See the plug-ins"
      />
    </div>
  </UCard>
</template>
