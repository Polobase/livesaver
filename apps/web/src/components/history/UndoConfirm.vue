<script setup lang="ts">
/**
 * Before a run from the history is taken back: what the undo will do. (The fix that was just
 * made is undone with one click where it is shown; here the run may be weeks old.)
 */
import { computed } from 'vue'
import type { Run } from '../../engine/types'
import { moment } from '../../lib/format'
import { runLook, startedAt, undoLines } from '../../lib/runs'

const props = defineProps<{ run?: Run }>()
const emit = defineEmits<{ close: []; confirm: [run: Run] }>()
const open = computed({
  get: () => props.run !== undefined,
  set: (value) => {
    if (!value) emit('close')
  },
})
const about = computed(() => {
  if (!props.run) return ''
  const at = startedAt(props.run)
  return `${runLook(props.run).title}${at ? ` (${moment(at)})` : ''}.`
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Undo this run?"
    :description="about"
    :ui="{ content: 'sm:max-w-lg', footer: 'justify-end' }"
  >
    <template v-if="run" #body>
      <ul class="space-y-2 text-sm" data-testid="undo-lines">
        <li v-for="line in undoLines(run)" :key="line" class="flex gap-2">
          <UIcon name="i-lucide-undo-2" class="mt-0.5 size-4 shrink-0 text-muted" />
          {{ line }}
        </li>
      </ul>
      <p class="mt-4 text-sm text-muted">
        Ableton Live has to be closed. An undo cannot be undone: to have the fix again, fix again.
      </p>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
      <UButton
        v-if="run"
        icon="i-lucide-undo-2"
        label="Undo the run"
        data-testid="undo-confirm"
        @click="emit('confirm', run)"
      />
    </template>
  </UModal>
</template>
