<script setup lang="ts">
/**
 * What has to be said on whichever page one is: livesaver is gone (nothing works until it is
 * back), and a scan that failed (it may have been started from any page).
 */
import { computed } from 'vue'
import CopyText from '../components/common/CopyText.vue'
import { disconnect, pairedAt } from '../engine/create'
import { browserFacts, unreachableAdvice, waysOf } from '../lib/ways'
import { useEngineStore } from '../stores/engine'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const scans = useScanStore()
const reload = () => window.location.reload()
const ways = computed(() => waysOf(browserFacts()))
const site = window.location.origin

/** A connected page waits for its livesaver's first answer: a browser may be asking the user. */
const connecting = computed(() => engines.paired && engines.loading && !engines.problem)

/**
 * A browser that keeps a page of a site from reaching this computer says nothing, and to the
 * page it is as if livesaver were gone. So a connected page says what this browser needs.
 */
const blocked = computed(() => engines.paired && ways.value.connect.state !== 'works')

/** What to do when livesaver is gone: it depends on how the page came to it. */
const advice = computed(() =>
  engines.kind !== 'computer'
    ? ['Reload this page to start again.']
    : engines.paired
      ? ['Nothing can be read or written until it is back.', ...unreachableAdvice(ways.value, site)]
      : [
          'Nothing can be read or written until it is back. If livesaver still runs, reload this page; if not, start it again with “livesaver web”: it opens the app anew.',
        ],
)

/**
 * livesaver serves the app itself at its own address. A browser lets anyone go there, also one
 * that keeps a page of a site from asking this computer for anything: a plain link.
 */
const fromHere = computed(() => {
  const at = engines.paired ? pairedAt() : undefined
  return at
    ? [
        {
          label: 'Open the app from this computer',
          to: at,
          icon: 'i-lucide-monitor',
          color: 'neutral' as const,
          variant: 'subtle' as const,
        },
      ]
    : []
})
const alone = {
  label: 'Use this page on its own',
  color: 'neutral' as const,
  variant: 'ghost' as const,
  onClick: disconnect,
}
const actions = computed(() => [
  ...fromHere.value,
  {
    label: 'Reload this page',
    color: 'neutral' as const,
    variant: fromHere.value.length ? ('ghost' as const) : ('subtle' as const),
    onClick: reload,
  },
  ...(engines.paired ? [alone] : []),
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
      :description="
        blocked
          ? ways.connect.text
          : `${ways.connect.text} If nothing happens, your browser does not let a site do that: open the app from this computer.`
      "
      role="status"
      data-testid="connecting"
      :actions="[...fromHere, alone]"
    />
    <UAlert
      v-else-if="engines.problem"
      color="error"
      variant="subtle"
      icon="i-lucide-unplug"
      :title="engines.problem"
      role="alert"
      data-testid="engine-problem"
      :actions="actions"
    >
      <template #description>
        <p v-for="line in advice" :key="line">{{ line }}</p>
        <p v-if="engines.paired && ways.connect.address" class="mt-1" data-testid="browser-setting">
          The setting:
          <CopyText :text="ways.connect.address" what="the address of the setting" />
          <span class="ms-3">
            This site: <CopyText :text="site" what="the address of this site" />
          </span>
        </p>
      </template>
    </UAlert>
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
