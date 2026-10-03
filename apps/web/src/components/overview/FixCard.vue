<script setup lang="ts">
/** What a fix would do now, and the way into it. */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { bytes, count, plural } from '../../lib/format'
import { GET_LIVESAVER } from '../../lib/links'
import { planOf } from '../../lib/plan'
import { useEngineStore } from '../../stores/engine'
import { useFixStore } from '../../stores/fix'
import { useScanStore } from '../../stores/scan'
import { useWritingStore } from '../../stores/writing'

const props = defineProps<{ scan: Scan }>()
const engines = useEngineStore()
const fix = useFixStore()
const scans = useScanStore()
const writing = useWritingStore()
const plan = computed(() => planOf(props.scan, undefined, false))
const counts = computed(() => props.scan.samples.counts)
</script>

<template>
  <UCard :ui="{ body: 'flex h-full flex-col' }" data-testid="fix-card">
    <div class="flex items-center gap-2 text-sm font-medium text-muted">
      <UIcon name="i-lucide-wrench" class="size-4 text-(--status-fixable)" />
      Can be fixed now
    </div>
    <template v-if="plan.sets > 0">
      <p class="mt-2 text-2xl font-semibold tracking-tight text-highlighted" data-testid="fixable">
        {{ plural(plan.sets, 'set') }}
        <span class="text-base font-normal text-muted">
          in {{ plural(plan.projects.length, 'project') }}
        </span>
      </p>
      <ul class="mt-3 space-y-1.5 text-sm">
        <li v-if="counts.found" class="flex justify-between gap-4">
          <span>Missing samples that were found elsewhere</span>
          <span class="tabular font-medium text-highlighted">{{ count(counts.found) }}</span>
        </li>
        <li v-if="counts.external" class="flex justify-between gap-4">
          <span>Samples outside their project, to collect</span>
          <span class="tabular font-medium text-highlighted">{{ count(counts.external) }}</span>
        </li>
        <li class="flex justify-between gap-4">
          <span>Files to copy into the projects</span>
          <span class="tabular font-medium text-highlighted">
            {{ count(plan.copyFiles) }}
            <span v-if="plan.copyFiles" class="font-normal text-muted">
              · {{ bytes(plan.copyBytes) }}
            </span>
          </span>
        </li>
        <li v-if="plan.uncertain" class="flex justify-between gap-4">
          <UTooltip
            text="The file was found by its name and place, but its fingerprint (size and checksum) does not confirm it. You can leave these out when you fix."
          >
            <span class="underline decoration-dotted underline-offset-4">Uncertain matches</span>
          </UTooltip>
          <span class="tabular font-medium text-highlighted">{{ count(plan.uncertain) }}</span>
        </li>
      </ul>
      <div class="mt-auto pt-5">
        <UButton
          v-if="engines.capabilities.fix"
          icon="i-lucide-list-checks"
          label="Review and fix"
          :disabled="scans.running || fix.running"
          data-testid="review"
          @click="fix.open()"
        />
        <div v-else class="space-y-2" data-testid="no-fix">
          <p class="text-sm text-muted">
            This page only reads. To fix, run <code class="text-xs">livesaver web</code> on your
            computer: it opens this app with livesaver behind it, which can write, back up and undo.
          </p>
          <UButton v-bind="GET_LIVESAVER" size="sm" color="neutral" variant="subtle" />
          <p v-if="writing.possible" class="text-sm text-muted" data-testid="can-write-here">
            Your browser can also let this page fix on its own, as an experiment with limits.
            <RouterLink to="/settings" class="underline underline-offset-2"
              >Switch it on in the Settings</RouterLink
            >.
          </p>
        </div>
        <p
          v-if="scans.stale && engines.capabilities.fix"
          class="mt-2 text-sm text-muted"
          role="note"
        >
          You changed folders or options after this scan. A fix does what this scan found; scan
          again to see what it would do with the changes.
        </p>
      </div>
    </template>
    <template v-else>
      <p class="mt-2 text-2xl font-semibold tracking-tight text-highlighted">Nothing to fix</p>
      <p class="mt-1 text-sm text-muted">
        No set has a sample that could be collected or found again in the folders that were
        searched.
      </p>
    </template>
  </UCard>
</template>
