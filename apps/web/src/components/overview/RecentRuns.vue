<script setup lang="ts">
/** The last things livesaver changed, and the way into the history. */
import { computed } from 'vue'
import { when } from '../../lib/format'
import { changedSomething, runLook, STATE_NOTE, startedAt } from '../../lib/runs'
import { useHistoryStore } from '../../stores/history'

const SHOWN = 3
const history = useHistoryStore()
const changes = computed(() => history.runs.filter(changedSomething))
const recent = computed(() =>
  changes.value.slice(0, SHOWN).map((run) => {
    const at = startedAt(run)
    return { run, look: runLook(run), at: at ? when(at.toISOString()) : run.when }
  }),
)
</script>

<template>
  <UCard v-if="recent.length" data-testid="recent-runs">
    <div class="flex items-center justify-between gap-3">
      <h3 class="flex items-center gap-2 text-sm font-medium text-muted">
        <UIcon name="i-lucide-history" class="size-4" />
        Last changes
      </h3>
      <UButton
        to="/history"
        size="sm"
        color="neutral"
        variant="link"
        class="p-0"
        trailing-icon="i-lucide-arrow-right"
        :label="changes.length > SHOWN ? `See all ${changes.length} in History` : 'See the history'"
      />
    </div>
    <ul class="mt-2 divide-y divide-default text-sm">
      <li
        v-for="{ run, look, at } in recent"
        :key="run.id"
        class="flex items-baseline justify-between gap-4 py-2"
      >
        <span class="min-w-0">
          <span class="text-highlighted">{{ look.title }}</span>
          <UBadge
            v-if="STATE_NOTE[run.state]"
            color="neutral"
            variant="subtle"
            size="sm"
            class="ms-2 align-middle"
            :label="STATE_NOTE[run.state]"
          />
        </span>
        <span class="tabular shrink-0 text-muted">{{ at }}</span>
      </li>
    </ul>
  </UCard>
</template>
