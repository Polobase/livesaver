<script setup lang="ts">
/** One run in the history: what it did, when and where, and what became of it. */
import { computed } from 'vue'
import type { Run } from '../../engine/types'
import { runFacts, runLook, STATE_NOTE, startedAt } from '../../lib/runs'
import { useEngineStore } from '../../stores/engine'
import { useHistoryStore } from '../../stores/history'

const props = defineProps<{ run: Run; last: boolean }>()
const emit = defineEmits<{ open: []; undo: [] }>()
const engines = useEngineStore()
const history = useHistoryStore()

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const look = computed(() => runLook(props.run))
const facts = computed(() => {
  const at = startedAt(props.run)
  return [at ? clock.format(at) : '', ...runFacts(props.run)].filter((fact) => fact).join(' · ')
})
const canUndo = computed(() => props.run.applied && props.run.canUndo && engines.capabilities.undo)
</script>

<template>
  <li class="relative flex gap-3 pb-6 last:pb-0" data-testid="run">
    <!-- The line of time, from this run to the one before it. -->
    <span
      v-if="!last"
      class="absolute start-4 top-9 bottom-1 w-px -translate-x-1/2 bg-(--ui-border)"
      aria-hidden="true"
    />
    <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated">
      <UIcon :name="look.icon" class="size-4 text-muted" />
    </span>
    <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div class="min-w-0 pt-0.5">
        <p class="font-medium text-highlighted">
          {{ look.title }}
          <UBadge
            v-if="STATE_NOTE[run.state]"
            color="neutral"
            variant="subtle"
            size="sm"
            class="ms-1 align-middle"
            :label="STATE_NOTE[run.state]"
          />
        </p>
        <p class="text-sm text-muted">{{ facts }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <UButton
          v-if="canUndo"
          size="sm"
          color="neutral"
          variant="subtle"
          icon="i-lucide-undo-2"
          :label="run.state === 'partly-undone' ? 'Undo the rest' : 'Undo'"
          :aria-label="`Undo: ${look.title}`"
          :loading="history.undoing === run.id"
          :disabled="history.busy"
          @click="emit('undo')"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          label="Details"
          :aria-label="`Details: ${look.title}`"
          @click="emit('open')"
        />
      </div>
    </div>
  </li>
</template>
