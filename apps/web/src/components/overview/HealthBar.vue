<script setup lang="ts">
/**
 * Parts of a whole in one bar: how many are fine, can be fixed, or have something missing. The
 * colours are told apart by position and by the legend below, which says each part in words.
 */
import { computed } from 'vue'
import { count, percent } from '../../lib/format'
import { HEALTH, HEALTHS, type Health } from '../../lib/health'

const props = defineProps<{
  totals: Readonly<Record<Health, number>>
  unit: string
  labels?: Partial<Record<Health, string>>
}>()

const whole = computed(() => HEALTHS.reduce((n, health) => n + props.totals[health], 0))
const parts = computed(() =>
  HEALTHS.filter((health) => props.totals[health] > 0).map((health) => ({
    health,
    look: HEALTH[health],
    label: props.labels?.[health] ?? HEALTH[health].label,
    value: props.totals[health],
    share: percent(props.totals[health], whole.value),
  })),
)
const summary = computed(() =>
  parts.value.map((part) => `${part.label}: ${count(part.value)} ${props.unit}`).join(', '),
)
</script>

<template>
  <div>
    <div class="fill-in flex h-3 gap-0.5" role="img" :aria-label="summary">
      <UTooltip
        v-for="part in parts"
        :key="part.health"
        :text="`${part.label}: ${count(part.value)} ${unit} (${part.share})`"
      >
        <div
          class="h-full min-w-1.5 first:rounded-s-full last:rounded-e-full"
          :style="{ flexGrow: part.value, backgroundColor: part.look.colour }"
        />
      </UTooltip>
    </div>
    <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="health-legend">
      <div v-for="part in parts" :key="part.health" class="flex items-center gap-1.5">
        <UIcon :name="part.look.icon" class="size-4 shrink-0" :class="part.look.tone" />
        <dt class="text-muted">{{ part.label }}</dt>
        <dd class="tabular font-medium text-highlighted">{{ count(part.value) }}</dd>
        <dd class="tabular text-muted">{{ part.share }}</dd>
      </div>
    </dl>
  </div>
</template>
