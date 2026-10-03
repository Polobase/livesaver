<script setup lang="ts">
/** Every set with what its samples are: fine, to fix, missing. */
import type { SetRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import type { Scan } from '../../engine/types'
import { count } from '../../lib/format'
import { HEALTHS, missingOf, setHealth } from '../../lib/health'
import { type Filter, narrow } from '../../lib/search'
import DataTable, { type Column } from '../common/DataTable.vue'
import PathText from '../common/PathText.vue'
import StatusPill from '../common/StatusPill.vue'
import TableToolbar from '../common/TableToolbar.vue'

const props = defineProps<{ scan: Scan }>()
const emit = defineEmits<{ open: [set: SetRow] }>()

const FILTERS: readonly Filter<SetRow>[] = [
  { label: 'All sets', test: () => true },
  { label: 'Samples missing', test: (row) => setHealth(row) === 'missing' },
  { label: 'Can be fixed', test: (row) => setHealth(row) === 'fixable' },
  { label: 'Complete', test: (row) => setHealth(row) === 'fine' },
  { label: 'Unreadable', test: (row) => Boolean(row.error) },
]
const fine = (row: SetRow) => row.counts.ok + row.counts.kept
const toFix = (row: SetRow) => row.counts.external + row.counts.found
const COLUMNS: readonly Column<SetRow>[] = [
  { id: 'set', label: 'Set', sort: (row) => row.name.toLowerCase() },
  { id: 'project', label: 'Project', sort: (row) => row.project.toLowerCase() },
  { id: 'live', label: 'Live', sort: (row) => row.live, class: 'w-24' },
  { id: 'state', label: 'State', sort: (row) => HEALTHS.indexOf(setHealth(row)), class: 'w-44' },
  { id: 'fine', label: 'Fine', sort: fine, numeric: true, class: 'w-20' },
  { id: 'fix', label: 'To fix', sort: toFix, numeric: true, class: 'w-24' },
  {
    id: 'missing',
    label: 'Missing',
    sort: (row) => missingOf(row.counts),
    numeric: true,
    class: 'w-24',
  },
]

const query = ref('')
const filter = ref('All sets')
const rows = computed(() =>
  narrow(
    props.scan.samples.setRows,
    FILTERS,
    filter.value,
    query.value,
    (row) => `${row.project} ${row.name} ${row.live} ${row.error}`,
  ),
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="sets"
      :filters="FILTERS.map((f) => f.label)"
      :shown="rows.length"
      :total="scan.samples.setRows.length"
    />
    <DataTable
      :rows="rows"
      :columns="COLUMNS"
      :row-id="(row) => row.path"
      caption="Sets"
      openable
      @open="emit('open', $event)"
    >
      <template #set="{ row }">
        <span class="block truncate font-medium" :title="row.error || row.name">{{
          row.name
        }}</span>
      </template>
      <template #project="{ row }"
        ><PathText :path="row.project" plain class="text-muted" /></template
      >
      <template #live="{ row }"><span class="text-muted">{{ row.live }}</span></template>
      <template #state="{ row }"><StatusPill :health="setHealth(row)" /></template>
      <template #fine="{ row }">
        <span :class="fine(row) ? '' : 'text-muted'">{{ count(fine(row)) }}</span>
      </template>
      <template #fix="{ row }">
        <span :class="toFix(row) ? '' : 'text-muted'">{{ count(toFix(row)) }}</span>
      </template>
      <template #missing="{ row }">
        <span :class="missingOf(row.counts) ? '' : 'text-muted'">
          {{ count(missingOf(row.counts)) }}
        </span>
      </template>
    </DataTable>
  </div>
</template>
