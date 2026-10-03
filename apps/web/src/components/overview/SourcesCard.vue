<script setup lang="ts">
/**
 * Where the samples that can be repaired were found, largest first. One series: every bar has
 * the same colour, the names tell them apart.
 */
import type { SourceRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import { count, plural } from '../../lib/format'

const props = defineProps<{ rows: readonly SourceRow[] }>()
const SHOWN = 6
const all = ref(false)
const shown = computed(() => (all.value ? props.rows : props.rows.slice(0, SHOWN)))
const largest = computed(() => props.rows[0]?.samples ?? 0)
</script>

<template>
  <UCard data-testid="found-sources">
    <h3 class="font-semibold text-highlighted">Where the found samples lie</h3>
    <p v-if="rows.length === 0" class="mt-2 text-sm text-muted">
      No missing sample was found in the folders that were searched.
    </p>
    <ul v-else class="mt-3 space-y-2.5 text-sm">
      <li v-for="row in shown" :key="`${row.kind}:${row.name}`">
        <div class="flex items-baseline gap-3">
          <span class="min-w-0 truncate font-medium text-highlighted" :title="row.name">
            {{ row.name }}
          </span>
          <span class="shrink-0 text-muted">{{ row.kind }}</span>
          <span class="tabular ms-auto shrink-0 text-highlighted">
            {{ plural(row.samples, 'sample') }}
          </span>
          <span class="tabular w-24 shrink-0 text-right text-muted">
            in {{ plural(row.projects, 'project') }}
          </span>
        </div>
        <div class="mt-1 h-1.5 rounded-full bg-elevated" aria-hidden="true">
          <div
            class="h-full rounded-full bg-(--ui-text-dimmed)"
            :style="{ width: `${Math.max(2, (row.samples / largest) * 100)}%` }"
          />
        </div>
      </li>
    </ul>
    <UButton
      v-if="rows.length > SHOWN"
      class="mt-2 p-0 underline"
      size="sm"
      color="neutral"
      variant="link"
      :label="all ? 'Show fewer' : `Show all ${count(rows.length)}`"
      @click="all = !all"
    />
  </UCard>
</template>
