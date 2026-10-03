<script setup lang="ts">
/** What stays missing after a fix, by where it came from, with what to do about the largest. */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, plural } from '../../lib/format'
import { adviceFor } from '../../lib/words'

const props = defineProps<{ scan: Scan }>()
const sources = computed(() => props.scan.samples.missingSources)
const top = computed(() => sources.value.slice(0, 3))
</script>

<template>
  <UCard :ui="{ body: 'flex h-full flex-col' }" data-testid="missing-card">
    <div class="flex items-center gap-2 text-sm font-medium text-muted">
      <UIcon name="i-lucide-triangle-alert" class="size-4 text-(--status-missing)" />
      Still missing
    </div>
    <template v-if="scan.samples.missing.length">
      <p class="mt-2 text-2xl font-semibold tracking-tight text-highlighted" data-testid="missing">
        {{ plural(scan.samples.missing.length, 'sample') }}
        <span class="text-base font-normal text-muted">
          from {{ plural(sources.length, 'source') }}
        </span>
      </p>
      <ul class="mt-3 space-y-3 text-sm">
        <li v-for="source in top" :key="`${source.kind}:${source.name}`">
          <div class="flex justify-between gap-4">
            <span class="min-w-0 truncate font-medium text-highlighted" :title="source.name">
              {{ source.name }}
            </span>
            <span class="tabular shrink-0">{{ count(source.samples) }}</span>
          </div>
          <p class="text-muted">{{ source.kind }}. {{ adviceFor(source).text }}</p>
        </li>
      </ul>
      <div class="mt-auto pt-5">
        <UButton
          to="/samples?tab=missing"
          color="neutral"
          variant="subtle"
          trailing-icon="i-lucide-arrow-right"
          label="See all missing samples"
        />
      </div>
    </template>
    <template v-else>
      <p class="mt-2 text-2xl font-semibold tracking-tight text-highlighted">Nothing</p>
      <p class="mt-1 text-sm text-muted">
        Every sample is in its project or was found in the folders that were searched.
      </p>
    </template>
  </UCard>
</template>
