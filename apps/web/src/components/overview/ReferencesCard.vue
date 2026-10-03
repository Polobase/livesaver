<script setup lang="ts">
/** Every sample reference of the library, by what it is: the detail under the headline. */
import type { Status } from '@livesaver/ops'
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, percent } from '../../lib/format'
import { HEALTH, type Health, STATUS_LABEL } from '../../lib/health'
import HealthBar from './HealthBar.vue'

const props = defineProps<{ scan: Scan }>()

const GROUPS: readonly { health: Health; label: string; statuses: readonly Status[] }[] = [
  { health: 'fine', label: 'Fine', statuses: ['ok', 'kept'] },
  { health: 'fixable', label: 'Can be fixed', statuses: ['external', 'found'] },
  { health: 'missing', label: 'Missing', statuses: ['not-found', 'ambiguous', 'mismatch'] },
]
const counts = computed(() => props.scan.samples.counts)
const sum = (statuses: readonly Status[]) => statuses.reduce((n, s) => n + counts.value[s], 0)
const total = computed(() => GROUPS.reduce((n, group) => n + sum(group.statuses), 0))
const totals = computed(() => ({
  fine: sum(GROUPS[0]?.statuses ?? []),
  fixable: sum(GROUPS[1]?.statuses ?? []),
  missing: sum(GROUPS[2]?.statuses ?? []),
  unreadable: 0,
}))
</script>

<template>
  <UCard data-testid="references">
    <h3 class="font-semibold text-highlighted">Sample references</h3>
    <p class="text-sm text-muted">
      {{ count(total) }} in all, counted per set: a sample used in several sets counts several
      times.
    </p>
    <HealthBar
      class="mt-4"
      :totals="totals"
      unit="references"
      :labels="{ fine: 'Fine', fixable: 'Can be fixed', missing: 'Missing' }"
    />
    <table class="mt-4 w-full text-sm">
      <caption class="sr-only">
        Sample references by state
      </caption>
      <thead class="sr-only">
        <tr>
          <th scope="col">State</th>
          <th scope="col">References</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody v-for="group in GROUPS" :key="group.health" class="border-t border-default">
        <tr v-for="status in group.statuses" :key="status">
          <th scope="row" class="py-1.5 text-left font-normal">
            <span class="inline-flex items-center gap-2">
              <UIcon
                :name="HEALTH[group.health].icon"
                class="size-4"
                :class="HEALTH[group.health].tone"
              />
              {{ STATUS_LABEL[status] }}
            </span>
          </th>
          <td class="tabular py-1.5 text-right text-highlighted" :data-status="status">
            {{ count(counts[status]) }}
          </td>
          <td class="tabular w-16 py-1.5 text-right text-muted">
            {{ percent(counts[status], total) }}
          </td>
        </tr>
      </tbody>
    </table>
  </UCard>
</template>
