<script setup lang="ts">
/** Every project: its state, what a fix does to it, and what stays missing. */
import type { ProjectRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import type { Scan } from '../../engine/types'
import { bytes, count, plural } from '../../lib/format'
import { HEALTHS, projectHealth } from '../../lib/health'
import { type Filter, narrow } from '../../lib/search'
import { useEngineStore } from '../../stores/engine'
import { useFixStore } from '../../stores/fix'
import { useScanStore } from '../../stores/scan'
import DataTable, { type Column } from '../common/DataTable.vue'
import PathText from '../common/PathText.vue'
import StatusPill from '../common/StatusPill.vue'
import TableToolbar from '../common/TableToolbar.vue'

const props = defineProps<{ scan: Scan }>()
const emit = defineEmits<{ open: [root: string] }>()
const engines = useEngineStore()
const fix = useFixStore()
const scans = useScanStore()

const FILTERS: readonly Filter<ProjectRow>[] = [
  { label: 'All projects', test: () => true },
  { label: 'Can be fixed', test: (row) => row.changingSets > 0 },
  { label: 'Samples missing', test: (row) => projectHealth(row) === 'missing' },
  { label: 'Complete', test: (row) => projectHealth(row) === 'fine' },
]
const COLUMNS: readonly Column<ProjectRow>[] = [
  { id: 'project', label: 'Project', sort: (row) => row.path.toLowerCase() },
  {
    id: 'state',
    label: 'State',
    sort: (row) => HEALTHS.indexOf(projectHealth(row)),
    class: 'w-44',
  },
  { id: 'sets', label: 'Sets', sort: (row) => row.sets, numeric: true, class: 'w-20' },
  { id: 'fix', label: 'To fix', sort: (row) => row.changes, numeric: true, class: 'w-24' },
  { id: 'missing', label: 'Missing', sort: (row) => row.missing, numeric: true, class: 'w-24' },
  { id: 'copies', label: 'To copy', sort: (row) => row.copyBytes, numeric: true, class: 'w-40' },
  { id: 'action', label: 'Fix', class: 'w-24', quiet: true },
]

const query = ref('')
const filter = ref('All projects')
const selected = ref<Record<string, boolean>>({})
const rows = computed(() =>
  narrow(props.scan.samples.projectRows, FILTERS, filter.value, query.value, (row) => row.path),
)
const fixable = computed(() => props.scan.samples.projectRows.filter((row) => row.changingSets > 0))
/** The ticked projects that still exist in this scan. */
const chosen = computed(() =>
  fixable.value.filter((row) => selected.value[row.root]).map((row) => row.root),
)
const busy = computed(() => scans.running || fix.running)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="projects"
      :filters="FILTERS.map((f) => f.label)"
      :shown="rows.length"
      :total="scan.samples.projectRows.length"
    >
      <template v-if="engines.capabilities.fix && fixable.length">
        <UButton
          v-if="chosen.length"
          color="neutral"
          variant="subtle"
          icon="i-lucide-list-checks"
          :label="`Fix ${plural(chosen.length, 'selected project')}`"
          :disabled="busy"
          data-testid="fix-selected"
          @click="fix.open(chosen)"
        />
        <UButton
          icon="i-lucide-list-checks"
          label="Fix all"
          :disabled="busy"
          data-testid="fix-all"
          @click="fix.open()"
        />
      </template>
    </TableToolbar>
    <DataTable
      v-model:selected="selected"
      :rows="rows"
      :columns="COLUMNS"
      :row-id="(row) => row.root"
      :row-label="(row) => row.path"
      caption="Projects"
      :selectable="engines.capabilities.fix"
      :can-select="(row) => row.changingSets > 0"
      openable
      @open="emit('open', $event.root)"
    >
      <template #project="{ row }"><PathText :path="row.path" class="font-medium" /></template>
      <template #state="{ row }"><StatusPill :health="projectHealth(row)" /></template>
      <template #sets="{ row }">{{ count(row.sets) }}</template>
      <template #fix="{ row }">
        <span :class="row.changes ? '' : 'text-muted'">{{ count(row.changes) }}</span>
      </template>
      <template #missing="{ row }">
        <span :class="row.missing ? '' : 'text-muted'">{{ count(row.missing) }}</span>
      </template>
      <template #copies="{ row }">
        <span v-if="row.copyFiles">
          {{ count(row.copyFiles) }}
          <span class="text-muted">· {{ bytes(row.copyBytes) }}</span>
        </span>
        <span v-else class="text-muted">0</span>
      </template>
      <template #action="{ row }">
        <UButton
          v-if="engines.capabilities.fix && row.changingSets > 0"
          size="xs"
          color="neutral"
          variant="subtle"
          label="Fix"
          :aria-label="`Fix ${row.path}`"
          :disabled="busy"
          @click="fix.open([row.root])"
        />
      </template>
    </DataTable>
  </div>
</template>
