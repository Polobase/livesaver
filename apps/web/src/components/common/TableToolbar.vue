<script setup lang="ts">
/** Above a table: search it, narrow it, and see how many rows are left. */
import { count } from '../../lib/format'

defineProps<{
  /** What the table lists: `projects`, `sets`… */
  name: string
  filters: readonly string[]
  shown: number
  total: number
}>()
const query = defineModel<string>('query', { required: true })
const filter = defineModel<string>('filter', { required: true })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-2.5 sm:px-6">
    <UInput
      v-model="query"
      type="search"
      icon="i-lucide-search"
      class="w-56"
      :placeholder="`Search ${name}`"
      :aria-label="`Search ${name}`"
      autocomplete="off"
    />
    <USelect v-model="filter" :items="[...filters]" class="w-48" :aria-label="`Filter ${name}`" />
    <span class="tabular text-sm text-muted" aria-live="polite" data-testid="shown">
      {{ count(shown) }}
      of {{ count(total) }}
    </span>
    <div class="ms-auto flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>
