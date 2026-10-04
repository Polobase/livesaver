<script setup lang="ts">
/**
 * What stays missing, grouped by where it came from: a pack, an expansion, an old drive, another
 * project. Each group says what to do about it, which is rarely the same for two of them.
 */
import type { MissingRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import type { FolderListing, Scan } from '../../engine/types'
import { missingAsText, missingGroups } from '../../lib/detail'
import { bytes, count, plural, splitPath } from '../../lib/format'
import { STATUS_LABEL } from '../../lib/health'
import { type Filter, matcher } from '../../lib/search'
import { adviceFor } from '../../lib/words'
import { useEngineStore } from '../../stores/engine'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import TableToolbar from '../common/TableToolbar.vue'
import FolderBrowser from '../library/FolderBrowser.vue'
import LibraryFilesHint from './LibraryFilesHint.vue'

const props = defineProps<{ scan: Scan }>()
const emit = defineEmits<{ open: [row: MissingRow] }>()
const engines = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const toast = useToast()

const FILTERS: readonly Filter<MissingRow>[] = [
  { label: 'All missing samples', test: () => true },
  { label: 'Not found', test: (row) => row.status === 'not-found' },
  { label: 'Different content', test: (row) => row.status === 'mismatch' },
  { label: 'Several candidates', test: (row) => row.status === 'ambiguous' },
]
/** Rows of a group shown at first, and with every "Show more". */
const PAGE = 50

const query = ref('')
const filter = ref('All missing samples')
const groups = computed(() => {
  const test = FILTERS.find((f) => f.label === filter.value)?.test ?? (() => true)
  const matches = matcher(query.value)
  return missingGroups(
    props.scan,
    (row) => test(row) && matches(`${row.name} ${row.path} ${row.source} ${row.sourceName}`),
  )
})
const shown = computed(() => groups.value.reduce((n, group) => n + group.rows.length, 0))

const keyOf = (group: { source: { kind: string; name: string } }) =>
  `${group.source.kind}\u0000${group.source.name}`
const opened = ref(new Set<string>())
const pages = ref(new Map<string, number>())
function toggle(key: string): void {
  const next = new Set(opened.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  opened.value = next
}
const limit = (key: string) => pages.value.get(key) ?? PAGE
function more(key: string): void {
  pages.value = new Map(pages.value).set(key, limit(key) + PAGE * 4)
}

async function copy(rows: readonly MissingRow[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(missingAsText(rows))
    toast.add({ title: `Copied ${plural(rows.length, 'line')}`, icon: 'i-lucide-clipboard-check' })
  } catch {
    toast.add({ title: 'The browser did not allow copying', color: 'error' })
  }
}

// Adding the folder that has the samples: on this computer by its path, right here.
const browsing = ref(false)
function added(folder: FolderListing): void {
  library.addPath('search', folder)
  toast.add({
    title: 'Sample folder added',
    description: 'Scan again to look for the missing samples in it.',
    icon: 'i-lucide-folder-check',
    actions: [{ label: 'Scan again', color: 'neutral', onClick: () => void scans.run() }],
  })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TableToolbar
      v-model:query="query"
      v-model:filter="filter"
      name="missing samples"
      :filters="FILTERS.map((f) => f.label)"
      :shown="shown"
      :total="scan.samples.missing.length"
    >
      <UButton
        color="neutral"
        variant="subtle"
        icon="i-lucide-clipboard-copy"
        label="Copy list"
        :disabled="shown === 0"
        @click="copy(groups.flatMap((group) => group.rows))"
      />
    </TableToolbar>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UEmpty
        v-if="scan.samples.missing.length === 0"
        icon="i-lucide-circle-check"
        title="Nothing is missing"
        description="Every sample is in its project or was found in the folders that were searched."
        class="my-16"
      />
      <p v-else-if="groups.length === 0" class="p-6 text-center text-sm text-muted">
        Nothing matches.
      </p>
      <LibraryFilesHint :scan="scan" class="mx-4 mt-3 sm:mx-6" />
      <ul v-if="groups.length" class="divide-y divide-default" data-testid="missing-groups">
        <li v-for="group in groups" :key="keyOf(group)" class="px-4 py-3 sm:px-6">
          <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
              :aria-expanded="opened.has(keyOf(group))"
              @click="toggle(keyOf(group))"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="mt-1 size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none"
                :class="opened.has(keyOf(group)) ? 'rotate-90' : ''"
              />
              <span class="min-w-0">
                <span class="flex flex-wrap items-baseline gap-x-2">
                  <span class="font-medium text-highlighted">{{ group.source.name }}</span>
                  <span class="text-sm text-muted">{{ group.source.kind }}</span>
                </span>
                <span class="block text-sm text-muted">{{ adviceFor(group.source).text }}</span>
              </span>
            </button>
            <div class="flex shrink-0 items-center gap-3">
              <span class="tabular text-sm text-muted">
                {{ plural(group.rows.length, 'sample') }}
                ·
                {{ plural(group.source.projects, 'project') }}
              </span>
              <UButton
                v-if="adviceFor(group.source).accept"
                size="xs"
                color="neutral"
                variant="subtle"
                icon="i-lucide-library"
                label="Take the installed files"
                :disabled="scans.running"
                @click="scans.acceptLibraryFiles()"
              />
              <template v-if="adviceFor(group.source).addFolder">
                <UButton
                  v-if="engines.capabilities.paths"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-folder-plus"
                  label="Add its folder"
                  @click="browsing = true"
                />
                <UButton
                  v-else
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-folder-plus"
                  label="Add its folder"
                  to="/settings"
                />
              </template>
            </div>
          </div>

          <div v-if="opened.has(keyOf(group))" class="mt-3 ms-6 overflow-x-auto">
            <table class="w-full table-fixed text-sm">
              <caption class="sr-only">
                Missing samples from
                {{ group.source.name }}
              </caption>
              <thead class="text-left text-muted">
                <tr>
                  <th scope="col" class="w-1/4 py-1.5 font-medium">Sample</th>
                  <th scope="col" class="w-40 py-1.5 font-medium">Why</th>
                  <th scope="col" class="py-1.5 font-medium">Folder it was in</th>
                  <th scope="col" class="w-24 py-1.5 text-right font-medium">Size</th>
                  <th scope="col" class="w-20 py-1.5 text-right font-medium">Sets</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default border-t border-default">
                <tr
                  v-for="row in group.rows.slice(0, limit(keyOf(group)))"
                  :key="`${row.status}:${row.path}`"
                  class="cursor-pointer hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
                  tabindex="0"
                  @click="emit('open', row)"
                  @keydown.enter.space.prevent="emit('open', row)"
                >
                  <td class="truncate py-1.5 pe-3 font-medium" :title="row.name">{{ row.name }}</td>
                  <td class="truncate py-1.5 pe-3">{{ STATUS_LABEL[row.status] }}</td>
                  <td class="truncate py-1.5 pe-3 text-muted" :title="row.path">
                    {{ splitPath(row.path).folder || row.path }}
                  </td>
                  <td class="tabular py-1.5 text-right text-muted">
                    {{ row.size ? bytes(row.size) : '' }}
                  </td>
                  <td class="tabular py-1.5 text-right">{{ count(row.sets) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="mt-2 flex gap-2">
              <UButton
                v-if="group.rows.length > limit(keyOf(group))"
                size="xs"
                color="neutral"
                variant="link"
                class="p-0 underline"
                :label="`Show more (${count(group.rows.length - limit(keyOf(group)))} left)`"
                @click="more(keyOf(group))"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="link"
                class="p-0 underline"
                label="Copy these"
                @click="copy(group.rows)"
              />
            </div>
          </div>
        </li>
      </ul>
    </div>

    <FolderBrowser
      v-if="engines.capabilities.paths"
      v-model:open="browsing"
      title="Add a sample folder"
      :start="library.search.at(-1)?.path ?? engines.start?.home ?? ''"
      :places="engines.start?.places ?? []"
      @choose="added"
    />
  </div>
</template>
