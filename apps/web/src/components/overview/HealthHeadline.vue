<script setup lang="ts">
/** The one sentence of the scan: how many sets are complete, and what becomes of the rest. */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, plural } from '../../lib/format'
import { setHealth, tally } from '../../lib/health'
import { leftOutWords } from '../../lib/library'
import { useScanStore } from '../../stores/scan'
import HealthBar from './HealthBar.vue'

const props = defineProps<{ scan: Scan }>()
const scans = useScanStore()
/** Sets the scan left out for the Live that saved them: they are in no number here. */
const leftOut = computed(() =>
  leftOutWords(props.scan.samples.leftOut, scans.scanned?.options.minLive),
)
const totals = computed(() => tally(props.scan.samples.setRows, setHealth))
const sets = computed(() => props.scan.samples.sets)
const rest = computed(() => {
  const t = totals.value
  return [
    t.fixable ? `${count(t.fixable)} more will be after a fix` : '',
    t.missing
      ? `${count(t.missing)} ${t.missing === 1 ? 'has' : 'have'} samples that stay missing`
      : '',
    t.unreadable ? `${count(t.unreadable)} could not be read` : '',
  ].filter((part) => part)
})
</script>

<template>
  <section aria-labelledby="headline">
    <h2 id="headline" class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
      <template v-if="sets === 0">No Live Sets found</template>
      <template v-else-if="totals.fine === sets">
        All {{ plural(sets, 'set') }} {{ sets === 1 ? 'is' : 'are' }} complete
      </template>
      <template v-else>
        <span class="tabular" data-testid="complete-sets">{{ count(totals.fine) }}</span>
        of
        {{ plural(sets, 'set') }} {{ totals.fine === 1 || sets === 1 ? 'is' : 'are' }} complete
      </template>
    </h2>
    <p class="mt-1 text-muted" data-testid="headline-rest">
      <template v-if="sets === 0">
        There is no <code class="text-sm">.als</code> file in the project folders (backup folders
        are not scanned).
      </template>
      <template v-else-if="rest.length">{{ rest.join(' · ') }}.</template>
      <template v-else>Every sample is where its set expects it.</template>
    </p>
    <p v-if="leftOut" class="mt-1 text-sm text-muted" data-testid="left-out">{{ leftOut }}</p>
    <HealthBar v-if="sets > 0" class="mt-5" :totals="totals" unit="sets" />
  </section>
</template>
