<script setup lang="ts">
/** Every change a fix would make, with how the file was found and how sure that is. */
import type { ChangeRow } from '@livesaver/ops'
import { computed, ref, watch } from 'vue'
import type { Scan } from '../../engine/types'
import { splitPath } from '../../lib/format'
import { ACTION_LABEL } from '../../lib/health'
import { type Filter, narrow } from '../../lib/search'
import DataTable, { type Column } from '../common/DataTable.vue'
import PathText from '../common/PathText.vue'
import TableToolbar from '../common/TableToolbar.vue'

const props = defineProps<{ scan: Scan; search?: string }>()
const emit = defineEmits<{ open: [change: ChangeRow] }>()

const FILTERS: readonly Filter<ChangeRow>[] = [
  { label: 'All planned changes', test: () => true },
  { label: 'Repair', test: (row) => row.action === 'repaired' },
  { label: 'Collect', test: (row) => row.action === 'collected' },
  { label: 'Update path', test: (row) => row.action === 'path-updated' },
  { label: 'Uncertain', test: (row) => !row.certain },
]
const ACTION_ICON: Readonly<Record<string, string>> = {
  repaired: 'i-lucide-link',
  collected: 'i-lucide-folder-input',
  'path-updated': 'i-lucide-pencil-line',
}
const COLUMNS: readonly Column<ChangeRow>[] = [
  { id: 'action', label: 'Action', sort: (row) => ACTION_LABEL[row.action] ?? '', class: 'w-36' },
  { id: 'sample', label: 'Sample', sort: (row) => row.name.toLowerCase(), class: 'w-[22%]' },
  { id: 'set', label: 'Set', sort: (row) => row.setPath.toLowerCase(), class: 'w-[30%]' },
  { id: 'to', label: 'Goes to', sort: (row) => row.newPath.toLowerCase() },
  { id: 'match', label: 'Match', sort: (row) => (row.certain ? 1 : 0), class: 'w-32' },
]

const query = ref(props.search ?? '')
const filter = ref('All planned changes')
// A link from elsewhere (a project's panel) brings its own search.
watch(
  () => props.search,
  (search) => {
    if (search !== undefined) query.value = search
  },
)
const rows = computed(() =>
  narrow(
    props.scan.samples.changes,
    FILTERS,
    filter.value,
    query.value,
    (row) => `${row.project} ${row.set} ${row.name} ${row.oldPath} ${row.newPath} ${row.source}`,
  ),
)
// A change has no name of its own: its place in the list tells it apart.
const ids = computed(() => new Map(props.scan.samples.changes.map((row, i) => [row, String(i)])))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="planned changes"
      :filters="FILTERS.map((f) => f.label)"
      :shown="rows.length"
      :total="scan.samples.changes.length"
    />
    <DataTable
      :rows="rows"
      :columns="COLUMNS"
      :row-id="(row) => ids.get(row) ?? ''"
      caption="Planned changes"
      openable
      @open="emit('open', $event)"
    >
      <template #action="{ row }">
        <span class="inline-flex items-center gap-1.5">
          <UIcon :name="ACTION_ICON[row.action] ?? 'i-lucide-circle'" class="size-4 text-muted" />
          {{ ACTION_LABEL[row.action] ?? row.action }}
        </span>
      </template>
      <template #sample="{ row }">
        <span class="block truncate font-medium" :title="row.name">{{ row.name }}</span>
      </template>
      <template #set="{ row }"><PathText :path="row.setPath" plain class="text-muted" /></template>
      <template #to="{ row }">
        <!-- The sample's name is in its own column: where it goes is the folder. -->
        <span class="block truncate text-muted" :title="row.newPath">
          {{ splitPath(row.newPath).folder || row.newPath }}
        </span>
      </template>
      <template #match="{ row }">
        <span v-if="row.certain" class="text-muted">Confirmed</span>
        <span v-else class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-circle-help" class="size-4 text-(--ui-warning)" />
          Uncertain
        </span>
      </template>
    </DataTable>
  </div>
</template>
