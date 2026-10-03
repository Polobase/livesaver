<script setup lang="ts">
/**
 * What follows a run that wrote: the library is scanned again. One line that takes the same
 * room while it scans and afterwards, so that nothing below it moves under a pointer that is
 * on its way to a button.
 */
import { computed } from 'vue'
import { count } from '../../lib/format'
import { PHASE_LABEL, type RunProgress } from '../../lib/progress'

const props = defineProps<{
  busy: boolean
  progress: RunProgress
  /** What to say once it was scanned again. */
  done: string
}>()
const how = computed(() =>
  props.progress.total > 0
    ? `${PHASE_LABEL[props.progress.phase].toLowerCase()}, ${count(props.progress.done)} of ${count(props.progress.total)}`
    : PHASE_LABEL[props.progress.phase].toLowerCase(),
)
</script>

<template>
  <p
    class="flex h-6 items-center gap-2 text-sm text-muted"
    role="status"
    aria-live="polite"
    data-testid="rescan"
  >
    <template v-if="busy">
      <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
      <span class="truncate">Scanning again: {{ how }}…</span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-circle-check" class="size-4 shrink-0 text-(--status-fine)" />
      <span class="truncate">{{ done }}</span>
    </template>
  </p>
</template>
