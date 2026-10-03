<script setup lang="ts">
/** Scan, from anywhere in the app, with the time of the last scan beside it. */
import { computed } from 'vue'
import { when } from '../../lib/format'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'

const library = useLibraryStore()
const scans = useScanStore()
const last = computed(() => (scans.scan ? when(scans.scan.at) : ''))
</script>

<template>
  <div class="flex items-center gap-3">
    <span
      v-if="last && !scans.running"
      class="hidden text-sm text-muted sm:inline"
      data-testid="scanned-at"
    >
      <template v-if="scans.stale">Changed since the scan of {{ last }}</template>
      <template v-else>Scanned {{ last }}</template>
    </span>
    <UTooltip :text="library.canScan ? 'Read every set again' : 'Add a project folder first'">
      <UButton
        icon="i-lucide-scan-search"
        :label="scans.scan ? 'Scan again' : 'Scan'"
        :loading="scans.running"
        :disabled="!library.canScan || scans.running"
        data-testid="scan"
        @click="scans.run()"
      />
    </UTooltip>
  </div>
</template>
