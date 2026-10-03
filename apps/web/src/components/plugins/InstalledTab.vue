<script setup lang="ts">
/** What is installed on this computer: format, native or Rosetta, and how many sets use it. */
import type { InstalledRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import type { Scan } from '../../engine/types'
import { count } from '../../lib/format'
import { type Filter, narrow } from '../../lib/search'
import DataTable, { type Column } from '../common/DataTable.vue'
import TableToolbar from '../common/TableToolbar.vue'

const props = defineProps<{ scan: Scan }>()
const emit = defineEmits<{ open: [plugin: InstalledRow] }>()

const FILTERS: readonly Filter<InstalledRow>[] = [
  { label: 'All installed', test: () => true },
  { label: 'Rosetta only', test: (row) => !row.native },
  { label: 'Used by no set', test: (row) => row.unused },
  { label: 'Not scanned by Live', test: (row) => !row.scanned },
]
const COLUMNS: readonly Column<InstalledRow>[] = [
  { id: 'plugin', label: 'Plug-in', sort: (row) => row.name.toLowerCase() },
  { id: 'format', label: 'Format', sort: (row) => row.format, class: 'w-24' },
  { id: 'runs', label: 'Runs', sort: (row) => (row.native ? 1 : 0), class: 'w-40' },
  { id: 'version', label: 'Version', sort: (row) => row.version, class: 'w-28' },
  { id: 'live', label: 'Known to Live', sort: (row) => (row.scanned ? 1 : 0), class: 'w-36' },
  { id: 'used', label: 'Used by', sort: (row) => row.usedBySets, numeric: true, class: 'w-32' },
]

/** What Live loads as a device: codecs and converters of the system are not plug-ins to it. */
const devices = computed(() => props.scan.plugins.installed.filter((row) => row.device))
const query = ref('')
const filter = ref('All installed')
const rows = computed(() =>
  narrow(devices.value, FILTERS, filter.value, query.value, (row) => `${row.name} ${row.format}`),
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="installed plug-ins"
      :filters="FILTERS.map((f) => f.label)"
      :shown="rows.length"
      :total="devices.length"
    />
    <DataTable
      :rows="rows"
      :columns="COLUMNS"
      :row-id="(row) => row.key"
      caption="Installed plug-ins"
      openable
      @open="emit('open', $event)"
    >
      <template #plugin="{ row }">
        <span class="block truncate font-medium" :title="row.name">{{
          row.name || row.ident
        }}</span>
      </template>
      <template #format="{ row }"><span class="text-muted">{{ row.format }}</span></template>
      <template #runs="{ row }">
        <span v-if="row.native" class="text-muted">Natively</span>
        <span v-else class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-cpu" class="size-4 text-(--status-fixable)" />
          Rosetta only
        </span>
      </template>
      <template #version="{ row }"><span class="text-muted">{{ row.version }}</span></template>
      <template #live="{ row }">
        <span class="text-muted">{{ row.scanned ? 'Yes' : 'Not scanned' }}</span>
      </template>
      <template #used="{ row }">
        <span v-if="row.usedBySets"
          >{{ count(row.usedBySets) }} {{ row.usedBySets === 1 ? 'set' : 'sets' }}</span
        >
        <span v-else class="text-muted">{{ row.unused ? 'no set' : 'another format' }}</span>
      </template>
    </DataTable>
  </div>
</template>
