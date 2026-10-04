<script setup lang="ts">
/** Every plug-in the sets use: in which format, how often, and whether Live can load it. */
import type { PluginUseRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import type { Scan } from '../../engine/types'
import { count } from '../../lib/format'
import { canUpgrade, PLUGIN_STATES, useText } from '../../lib/plugins'
import { type Filter, narrow } from '../../lib/search'
import DataTable, { type Column } from '../common/DataTable.vue'
import TableToolbar from '../common/TableToolbar.vue'
import PluginPill from './PluginPill.vue'

const props = defineProps<{ scan: Scan }>()
const emit = defineEmits<{ open: [use: PluginUseRow] }>()

const FILTERS: readonly Filter<PluginUseRow>[] = [
  { label: 'All plug-ins', test: () => true },
  { label: 'Not installed', test: (row) => row.state === 'missing' },
  { label: 'Rosetta only', test: (row) => row.state === 'rosetta' },
  { label: 'Can be upgraded', test: canUpgrade },
  { label: 'Installed', test: (row) => row.state === 'installed' },
]
const COLUMNS: readonly Column<PluginUseRow>[] = [
  { id: 'plugin', label: 'Plug-in', sort: (row) => row.name.toLowerCase() },
  { id: 'format', label: 'Format', sort: (row) => row.format, class: 'w-24' },
  { id: 'state', label: 'State', sort: (row) => PLUGIN_STATES.indexOf(row.state), class: 'w-40' },
  { id: 'note', label: 'What can be done', class: 'w-56' },
  {
    id: 'instances',
    label: 'Instances',
    sort: (row) => row.instances,
    numeric: true,
    class: 'w-28',
  },
  { id: 'sets', label: 'Sets', sort: (row) => row.sets.length, numeric: true, class: 'w-20' },
  {
    id: 'projects',
    label: 'Projects',
    sort: (row) => row.projects.length,
    numeric: true,
    class: 'w-24',
  },
]

const query = ref('')
const filter = ref('All plug-ins')
const rows = computed(() =>
  narrow(props.scan.plugins.uses, FILTERS, filter.value, query.value, useText),
)

/** The one thing worth saying about a plug-in in a table's row. */
function note(use: PluginUseRow): string {
  if (canUpgrade(use)) return 'Can be upgraded to VST3'
  if (use.vst3) return 'VST3 installed (not verified)'
  if (use.state !== 'installed' && use.nativeAlternative)
    return `Installed as ${use.nativeAlternative.format}`
  return ''
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <p
      v-if="!scan.plugins.inventory"
      class="border-b border-default px-4 py-2.5 text-sm text-muted sm:px-6"
      role="note"
      data-testid="no-inventory"
    >
      These are the plug-ins your sets use. Whether they are installed, a page in a browser cannot
      see by itself: add your plug-in folder and Live's database folder in the
      <RouterLink to="/settings" class="underline underline-offset-2">Settings</RouterLink>, or open
      the app with <code class="text-xs">livesaver web</code> to compare them with what is on this
      computer.
    </p>
    <p
      v-else-if="scan.installed && (!scan.installed.database || !scan.installed.roots.length)"
      class="border-b border-default px-4 py-2.5 text-sm text-muted sm:px-6"
      role="note"
      data-testid="partial-inventory"
    >
      <template v-if="!scan.installed.roots.length">
        No plug-in folder was among the folders that say what is installed, so every plug-in counts
        as not installed. Add <code class="text-xs">/Library/Audio/Plug-Ins</code> in the Settings.
      </template>
      <template v-else>
        Live's plug-in database was not among the folders that say what is installed. Without it a
        plug-in is known only if its bundle says which one it is (an Audio Unit does, and a newer
        VST3): most VST plug-ins count as not installed. Add the folder
        <code class="text-xs">Live Database</code>
        in the Settings.
      </template>
    </p>
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="plug-ins"
      :filters="FILTERS.map((f) => f.label)"
      :shown="rows.length"
      :total="scan.plugins.uses.length"
    />
    <DataTable
      :rows="rows"
      :columns="COLUMNS"
      :row-id="(row) => row.key"
      caption="Plug-ins the sets use"
      openable
      @open="emit('open', $event)"
    >
      <template #plugin="{ row }">
        <span class="flex items-baseline gap-2">
          <span class="truncate font-medium" :title="row.name">{{ row.name || '(no name)' }}</span>
          <span v-if="row.format === 'VST2'" class="shrink-0 text-xs text-muted">{{
            row.code
          }}</span>
        </span>
      </template>
      <template #format="{ row }"><span class="text-muted">{{ row.format }}</span></template>
      <template #state="{ row }"><PluginPill :state="row.state" /></template>
      <template #note="{ row }">
        <span class="block truncate text-muted" :title="note(row)">{{ note(row) }}</span>
      </template>
      <template #instances="{ row }">{{ count(row.instances) }}</template>
      <template #sets="{ row }">{{ count(row.sets.length) }}</template>
      <template #projects="{ row }">{{ count(row.projects.length) }}</template>
    </DataTable>
  </div>
</template>
