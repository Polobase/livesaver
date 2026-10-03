<script setup lang="ts">
/**
 * VST2 plug-ins that can become VST3: what converts, and what stands in the way of the rest. The
 * plan is made when this is opened: it reads the sets with VST2 plug-ins once more.
 */
import type { UpgradeSetRow } from '@livesaver/ops'
import { computed, onMounted, ref, watch } from 'vue'
import { count, plural, when } from '../../lib/format'
import { GET_LIVESAVER } from '../../lib/links'
import { type Filter, narrow } from '../../lib/search'
import { blockerLines, upgradeSum } from '../../lib/upgrade'
import { useEngineStore } from '../../stores/engine'
import { usePluginsStore } from '../../stores/plugins'
import { useScanStore } from '../../stores/scan'
import DataTable, { type Column } from '../common/DataTable.vue'
import PathText from '../common/PathText.vue'
import TableToolbar from '../common/TableToolbar.vue'
import ScanProgress from '../scan/ScanProgress.vue'

const engines = useEngineStore()
const plugins = usePluginsStore()
const scans = useScanStore()

// The plan of the scan that is shown, made once this tab is looked at.
const wanted = computed(
  () => engines.capabilities.upgrade && scans.scan !== undefined && !scans.running,
)
function plan(): void {
  if (wanted.value && !plugins.plan && !plugins.planning && !plugins.problem)
    void plugins.loadPlan()
}
onMounted(plan)
watch([wanted, () => plugins.plan], plan)

/** The plug-ins that are ticked for the upgrade: all that can convert, until one is unticked. */
const unticked = ref(new Set<string>())
const ticked = computed(() =>
  plugins.convertible.map((plugin) => plugin.plugin).filter((name) => !unticked.value.has(name)),
)
function tick(name: string, on: boolean): void {
  const next = new Set(unticked.value)
  if (on) next.delete(name)
  else next.add(name)
  unticked.value = next
}
// A new plan (after an upgrade, an undo, a scan) starts with everything ticked again: what was
// left out before may be all that is left now.
watch(
  () => plugins.plan,
  () => {
    unticked.value = new Set()
  },
)
const sum = computed(() => (plugins.plan ? upgradeSum(plugins.plan, ticked.value) : undefined))
const busy = computed(() => scans.running || plugins.running || plugins.undoing || plugins.planning)

// --- every plug-in in every set
const FILTERS: readonly Filter<UpgradeSetRow>[] = [
  { label: 'All', test: () => true },
  { label: 'Converts', test: (row) => row.converted },
  { label: 'Stays as it is', test: (row) => !row.converted },
]
const COLUMNS: readonly Column<UpgradeSetRow>[] = [
  { id: 'set', label: 'Set', sort: (row) => `${row.project}/${row.set}`.toLowerCase() },
  { id: 'plugin', label: 'Plug-in', sort: (row) => row.plugin.toLowerCase(), class: 'w-40' },
  {
    id: 'instances',
    label: 'Instances',
    sort: (row) => row.instances,
    numeric: true,
    class: 'w-28',
  },
  { id: 'result', label: 'What happens', sort: (row) => (row.converted ? 0 : 1), class: 'w-[38%]' },
]
const query = ref('')
const filter = ref('All')
const setRows = computed(() => (plugins.plan?.rows ?? []).filter((row) => row.plugin || row.error))
const rows = computed(() =>
  narrow(
    setRows.value,
    FILTERS,
    filter.value,
    query.value,
    (row) => `${row.project} ${row.set} ${row.plugin}`,
  ),
)
const why = (row: UpgradeSetRow) =>
  row.error ||
  (row.converted
    ? row.written
      ? 'Upgraded'
      : 'Converts to VST3'
    : row.blockers.map((blocker) => blocker.reason).join('; '))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="!engines.capabilities.upgrade" class="m-auto max-w-lg p-6" data-testid="no-upgrade">
      <UEmpty
        icon="i-lucide-circle-arrow-up"
        title="Upgrading needs livesaver on your computer"
        description="Switching a set from a VST2 plug-in to its VST3 rewrites the set, and needs to know which VST3 plug-ins Live has. Run “livesaver web” on your computer: it opens this app with livesaver behind it, which can write, back up and undo."
        :actions="[{ ...GET_LIVESAVER, color: 'neutral', variant: 'subtle' }]"
      />
    </div>

    <div v-else-if="plugins.planning" class="m-auto w-full max-w-md p-6">
      <ScanProgress :progress="plugins.progress" title="Looking at the sets with VST2 plug-ins" />
    </div>

    <div v-else-if="plugins.problem" class="m-auto w-full max-w-lg p-6">
      <UAlert
        color="neutral"
        variant="outline"
        icon="i-lucide-circle-help"
        title="Nothing can be upgraded here"
        :description="plugins.problem"
        role="note"
        :actions="[
          {
            label: 'Try again',
            color: 'neutral',
            variant: 'subtle',
            onClick: () => {
              plugins.problem = ''
              void plugins.loadPlan()
            },
          },
        ]"
      />
    </div>

    <template v-else-if="plugins.plan && sum">
      <div class="space-y-4 border-b border-default p-4 sm:px-6">
        <UAlert
          v-if="plugins.failure"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          title="It did not work"
          :description="plugins.failure.message"
          role="alert"
          close
          @update:open="plugins.dismiss()"
        />
        <UAlert
          v-if="plugins.upgraded"
          color="neutral"
          variant="subtle"
          icon="i-lucide-circle-check"
          :ui="{ icon: 'text-(--status-fine)' }"
          :title="`Upgraded: ${plural(plugins.upgraded.sets, 'set')} rewritten.`"
          role="status"
          data-testid="upgraded"
          :actions="[
            {
              label: 'Undo this upgrade',
              icon: 'i-lucide-undo-2',
              color: 'neutral',
              variant: 'subtle',
              disabled: busy,
              onClick: () => void plugins.undo(plugins.upgraded?.run ?? ''),
            },
          ]"
          close
          @update:open="plugins.dismiss()"
        />
        <UAlert
          v-if="plugins.undone"
          color="neutral"
          variant="subtle"
          icon="i-lucide-undo-2"
          :title="`Undone: ${plural(plugins.undone.restored, 'set')} restored.`"
          role="status"
          data-testid="upgrade-undone"
          close
          @update:open="plugins.dismiss()"
        />
        <UAlert
          v-if="plugins.last && !plugins.upgraded"
          color="neutral"
          variant="outline"
          icon="i-lucide-history"
          :title="`The last upgrade, ${when(plugins.last.record?.started ?? '') || plugins.last.when}, rewrote ${plural(plugins.last.sets, 'set')}.`"
          role="status"
          data-testid="last-upgrade"
          :actions="[
            {
              label: 'Undo this upgrade',
              icon: 'i-lucide-undo-2',
              color: 'neutral',
              variant: 'subtle',
              disabled: busy,
              onClick: () => void plugins.undo(plugins.last?.id ?? ''),
            },
          ]"
        />

        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-highlighted" data-testid="upgrade-headline">
              <template v-if="plugins.convertible.length">
                {{ plural(sum.sets, 'set') }}
                can be upgraded:
                {{ plural(sum.instances, 'instance') }}
                of
                {{ plural(ticked.length, 'plug-in') }}
              </template>
              <template v-else>Nothing to upgrade</template>
            </h2>
            <p class="max-w-3xl text-sm text-muted">
              livesaver switches a VST2 plug-in to its installed VST3 where it has verified that the
              sound stays the same. In a set, a plug-in is switched only if all of its instances
              there can be.
            </p>
          </div>
          <UButton
            v-if="plugins.convertible.length"
            class="shrink-0"
            icon="i-lucide-list-checks"
            label="Review and upgrade"
            :disabled="busy || sum.sets === 0"
            data-testid="review-upgrade"
            @click="plugins.open(ticked)"
          />
        </div>

        <ul class="grid gap-3 lg:grid-cols-3" data-testid="upgrade-plugins">
          <li
            v-for="plugin in plugins.plan.plugins"
            :key="plugin.plugin"
            class="rounded-lg border border-default p-3 text-sm"
          >
            <div class="flex items-center justify-between gap-2">
              <UCheckbox
                v-if="plugin.convertibleSets > 0"
                :model-value="!unticked.has(plugin.plugin)"
                :label="plugin.plugin"
                :ui="{ label: 'font-semibold text-highlighted' }"
                @update:model-value="tick(plugin.plugin, $event === true)"
              />
              <span v-else class="font-semibold text-highlighted">{{ plugin.plugin }}</span>
              <span class="tabular shrink-0 text-muted">
                {{ count(plugin.convertibleInstances) }}
                of {{ count(plugin.instances) }}
              </span>
            </div>
            <p class="mt-1 text-muted">
              <template v-if="plugin.convertibleSets > 0">
                Converts in {{ count(plugin.convertibleSets) }} of {{ plural(plugin.sets, 'set') }}.
              </template>
              <template v-else>Converts in none of its {{ plural(plugin.sets, 'set') }}.</template>
            </p>
            <ul v-if="plugin.blockers.length" class="mt-1 space-y-0.5 text-muted">
              <li v-for="line in blockerLines(plugin)" :key="line">{{ line }}</li>
            </ul>
          </li>
        </ul>
        <p
          v-if="plugins.plan.unverified.length"
          class="text-sm text-muted"
          data-testid="unverified"
        >
          Other VST2 plug-ins whose VST3 is installed stay as they are, because the switch is not
          verified for them:
          {{
            plugins.plan.unverified
              .map((plugin) => `${plugin.plugin} (${plugin.instances})`)
              .join(', ')
          }}.
        </p>
      </div>

      <TableToolbar
        v-model:query="query"
        v-model:filter="filter"
        name="sets"
        :filters="FILTERS.map((f) => f.label)"
        :shown="rows.length"
        :total="setRows.length"
      />
      <DataTable
        :rows="rows"
        :columns="COLUMNS"
        :row-id="(row) => `${row.root}\u0000${row.set}\u0000${row.plugin}`"
        caption="Plug-ins per set and what an upgrade does to them"
        empty="No set uses a plug-in an upgrade knows."
      >
        <template #set="{ row }"><PathText :path="`${row.project}/${row.set}`" /></template>
        <template #plugin="{ row }">{{ row.plugin }}</template>
        <template #instances="{ row }">{{ count(row.instances) }}</template>
        <template #result="{ row }">
          <span class="flex items-center gap-1.5" :title="why(row)">
            <UIcon
              :name="row.converted ? 'i-lucide-circle-arrow-up' : 'i-lucide-minus'"
              class="size-4 shrink-0"
              :class="row.converted ? 'text-(--status-fixable)' : 'text-muted'"
            />
            <span class="truncate" :class="row.converted ? '' : 'text-muted'">{{ why(row) }}</span>
          </span>
        </template>
      </DataTable>
    </template>
  </div>
</template>
