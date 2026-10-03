<script setup lang="ts">
/** One planned change, or one missing sample, in full: what a row of a table has no room for. */
import type { ChangeRow, MissingRow } from '@livesaver/ops'
import { computed } from 'vue'
import { bytes, count } from '../../lib/format'
import { ACTION_LABEL, ACTION_WHY, STATUS_LABEL, STATUS_WHY } from '../../lib/health'
import ScrollRegion from '../common/ScrollRegion.vue'

const props = defineProps<{ change?: ChangeRow; missing?: MissingRow }>()
const emit = defineEmits<{ close: [] }>()
const open = computed({
  get: () => props.change !== undefined || props.missing !== undefined,
  set: (value) => {
    if (!value) emit('close')
  },
})
const title = computed(() => props.change?.name ?? props.missing?.name ?? '')
const subtitle = computed(() =>
  props.change
    ? (ACTION_LABEL[props.change.action] ?? props.change.action)
    : props.missing
      ? STATUS_LABEL[props.missing.status]
      : '',
)
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :description="subtitle"
    :ui="{ content: 'sm:max-w-xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template v-if="change" #body>
      <ScrollRegion :label="title" class="space-y-5 p-4 text-sm sm:p-6">
        <p class="text-muted">{{ ACTION_WHY[change.action] }}</p>
        <dl class="space-y-3">
          <div>
            <dt class="text-muted">Set</dt>
            <dd class="break-all text-highlighted">{{ change.setPath }}</dd>
          </div>
          <div>
            <dt class="text-muted">The set points at</dt>
            <dd class="break-all">{{ change.oldPath }}</dd>
          </div>
          <div>
            <dt class="text-muted">After the fix it points at</dt>
            <dd class="break-all text-highlighted">{{ change.newPath }}</dd>
          </div>
          <div v-if="change.source">
            <dt class="text-muted">Copied from</dt>
            <dd class="break-all">{{ change.source }}</dd>
          </div>
          <div v-if="change.method">
            <dt class="text-muted">How it was found</dt>
            <dd>{{ change.method }}</dd>
          </div>
          <div>
            <dt class="text-muted">Match</dt>
            <dd v-if="change.certain">Confirmed.</dd>
            <dd v-else>
              Uncertain: the file was found by its name and place, but its fingerprint (size and
              checksum) does not confirm it. Listen to it after the fix, or leave uncertain matches
              out when you fix.
            </dd>
          </div>
        </dl>
      </ScrollRegion>
    </template>
    <template v-else-if="missing" #body>
      <ScrollRegion :label="title" class="space-y-5 p-4 text-sm sm:p-6">
        <p class="text-muted">{{ STATUS_WHY[missing.status as keyof typeof STATUS_WHY] }}</p>
        <dl class="space-y-3">
          <div>
            <dt class="text-muted">{{ missing.device ? 'Max device' : 'Sample' }}</dt>
            <dd class="break-all text-highlighted">{{ missing.path }}</dd>
          </div>
          <div>
            <dt class="text-muted">Came from</dt>
            <dd>{{ missing.sourceName }} ({{ missing.sourceKind }})</dd>
          </div>
          <div v-if="missing.size">
            <dt class="text-muted">Size when the set was saved</dt>
            <dd class="tabular">{{ bytes(missing.size) }} ({{ count(missing.size) }} bytes)</dd>
          </div>
          <div>
            <dt class="text-muted">Used by</dt>
            <dd>
              <ul>
                <li v-for="set in missing.usedBy.slice(0, 20)" :key="set" class="break-all">
                  {{ set }}
                </li>
                <li v-if="missing.usedBy.length > 20" class="text-muted">
                  and {{ count(missing.usedBy.length - 20) }} more
                </li>
              </ul>
            </dd>
          </div>
          <div v-if="missing.candidates.length">
            <dt class="text-muted">Files of this name that were found, and are not it</dt>
            <dd>
              <ul>
                <li v-for="file in missing.candidates" :key="file" class="break-all">{{ file }}</li>
              </ul>
            </dd>
          </div>
        </dl>
      </ScrollRegion>
    </template>
  </USlideover>
</template>
