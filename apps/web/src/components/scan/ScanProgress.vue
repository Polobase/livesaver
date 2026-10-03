<script setup lang="ts">
/** A scan as it goes: which phase, how many sets, which one. */
import { computed } from 'vue'
import { count } from '../../lib/format'
import { PHASE_LABEL, type RunProgress } from '../../lib/progress'

const props = defineProps<{ progress: RunProgress; title: string }>()
const counting = computed(() => props.progress.total > 0)
const detail = computed(() =>
  counting.value
    ? props.progress.name
    : props.progress.files
      ? `${count(props.progress.files)} audio files and Max devices listed`
      : '',
)
</script>

<template>
  <UCard role="status" aria-live="polite" data-testid="progress">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-loader-circle" class="size-5 shrink-0 animate-spin text-muted" />
      <div class="min-w-0 flex-1">
        <p class="font-medium text-highlighted">{{ title }}</p>
        <p class="text-sm text-muted">
          {{ PHASE_LABEL[progress.phase]
          }}<template v-if="counting"
            >: {{ count(progress.done) }} of {{ count(progress.total) }}</template
          ><template v-else>…</template>
        </p>
      </div>
    </div>
    <UProgress
      class="mt-4"
      size="sm"
      :model-value="counting ? progress.done : null"
      :max="counting ? progress.total : 100"
    />
    <p class="mt-2 h-5 truncate text-sm text-muted">{{ detail }}</p>
  </UCard>
</template>
