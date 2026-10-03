<script setup lang="ts">
/**
 * What has to be said on whichever page one is: livesaver is gone (nothing works until it is
 * back), and a scan that failed (it may have been started from any page).
 */
import { useEngineStore } from '../stores/engine'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const scans = useScanStore()
const reload = () => window.location.reload()
</script>

<template>
  <div
    v-if="engines.problem || (scans.problem && !scans.running)"
    class="space-y-3 border-b border-default p-4 sm:px-6"
  >
    <UAlert
      v-if="engines.problem"
      color="error"
      variant="subtle"
      icon="i-lucide-unplug"
      :title="engines.problem"
      :description="
        engines.kind === 'computer'
          ? 'Nothing can be read or written until it is back. If livesaver still runs, reload this page; if not, start it again with “livesaver web”: it opens the app anew.'
          : 'Reload this page to start again.'
      "
      role="alert"
      data-testid="engine-problem"
      :actions="[{ label: 'Reload this page', color: 'neutral', variant: 'subtle', onClick: reload }]"
    />
    <UAlert
      v-else-if="scans.problem"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="The scan did not work"
      :description="scans.problem"
      role="alert"
      data-testid="scan-problem"
      close
      @update:open="scans.problem = ''"
    />
  </div>
</template>
