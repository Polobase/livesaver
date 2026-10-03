<script setup lang="ts">
/**
 * What has to be said on whichever page one is: livesaver is gone (nothing works until it is
 * back), and a scan that failed (it may have been started from any page).
 */
import { computed } from 'vue'
import { disconnect } from '../engine/create'
import { useEngineStore } from '../stores/engine'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const scans = useScanStore()
const reload = () => window.location.reload()

/** A connected page waits for its livesaver's first answer: a browser may be asking the user. */
const connecting = computed(() => engines.paired && engines.loading && !engines.problem)

/** What to do when livesaver is gone: it depends on how the page came to it. */
const advice = computed(() =>
  engines.kind !== 'computer'
    ? 'Reload this page to start again.'
    : engines.paired
      ? 'Nothing can be read or written until it is back. If livesaver runs, your browser may keep this page from reaching it (Safari does): use the app that “livesaver web” opens itself. If it was stopped, start it again with “livesaver web --pair”, which connects this page anew.'
      : 'Nothing can be read or written until it is back. If livesaver still runs, reload this page; if not, start it again with “livesaver web”: it opens the app anew.',
)
const actions = computed(() => [
  {
    label: 'Reload this page',
    color: 'neutral' as const,
    variant: 'subtle' as const,
    onClick: reload,
  },
  ...(engines.paired
    ? [
        {
          label: 'Use this page on its own',
          color: 'neutral' as const,
          variant: 'ghost' as const,
          onClick: disconnect,
        },
      ]
    : []),
])
</script>

<template>
  <div
    v-if="engines.problem || connecting || (scans.problem && !scans.running)"
    class="space-y-3 border-b border-default p-4 sm:px-6"
  >
    <!-- A page of a site reaches this computer only if the browser lets it, and some ask first. -->
    <UAlert
      v-if="connecting"
      color="neutral"
      variant="subtle"
      icon="i-lucide-link"
      title="Connecting to livesaver on this computer …"
      description="Your browser may ask whether this page may reach your computer: allow it. If nothing happens, your browser does not let a site do that; use the app that “livesaver web” opens itself."
      role="status"
      data-testid="connecting"
      :actions="[
        { label: 'Use this page on its own', color: 'neutral', variant: 'subtle', onClick: disconnect },
      ]"
    />
    <UAlert
      v-else-if="engines.problem"
      color="error"
      variant="subtle"
      icon="i-lucide-unplug"
      :title="engines.problem"
      :description="advice"
      role="alert"
      data-testid="engine-problem"
      :actions="actions"
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
