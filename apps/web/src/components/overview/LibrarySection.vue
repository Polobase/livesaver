<script setup lang="ts">
/**
 * The folders of the library on the overview, after a scan: one line that says what was read,
 * which opens into the folders and options themselves. A folder is then added, and the library
 * scanned again, where the result is read, without a visit to another page.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { plural } from '../../lib/format'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import LibrarySetup from '../library/LibrarySetup.vue'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const scans = useScanStore()

const open = ref(false)
const section = useTemplateRef<HTMLElement>('section')
/** A link from elsewhere ("To the folders") opens the section, and brings it into view. */
watch(
  () => route.query.folders,
  (asked) => {
    if (asked === undefined) return
    open.value = true
    void nextTick(() => section.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  },
  { immediate: true },
)
/** Folders that wait are something to do: the section is open, with what it says about them. */
watch(
  () => library.waiting.length,
  (waiting) => {
    if (waiting) open.value = true
  },
  { immediate: true },
)
function toggle(): void {
  open.value = !open.value
  // (Closed by hand, a link that opened it is no longer followed.)
  if (!open.value && route.query.folders !== undefined) void router.replace({ query: {} })
}

const there = (folders: readonly { waits?: string }[]) =>
  folders.filter((folder) => !folder.waits).length
const summary = computed(() =>
  [
    plural(there(library.projects), 'project folder'),
    plural(there(library.search), 'sample folder'),
    library.waiting.length ? `${library.waiting.length} not read yet` : '',
    scans.stale ? 'changed since the scan' : '',
  ]
    .filter((part) => part)
    .join(' · '),
)
</script>

<template>
  <section
    ref="section"
    class="scroll-mt-4 rounded-lg border border-default"
    aria-labelledby="library-section-title"
    data-testid="library-section"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
      :aria-expanded="open"
      aria-controls="library-section-body"
      data-testid="library-toggle"
      @click="toggle"
    >
      <UIcon name="i-lucide-folders" class="size-5 shrink-0 text-muted" />
      <span class="min-w-0 flex-1">
        <span id="library-section-title" class="font-semibold text-highlighted">Your library</span>
        <span class="ms-2 text-sm text-muted" data-testid="library-summary">{{ summary }}</span>
      </span>
      <span class="hidden text-sm text-muted sm:inline">
        {{ open ? 'Close' : 'Folders and options' }}
      </span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none"
        :class="open ? 'rotate-180' : ''"
      />
    </button>
    <div v-if="open" id="library-section-body" class="border-t border-default p-4">
      <LibrarySetup compact />
      <div class="mt-5 flex flex-wrap items-center gap-3 border-t border-default pt-4">
        <UButton
          icon="i-lucide-scan-search"
          label="Scan again"
          :loading="scans.running"
          :disabled="!library.canScan || scans.running"
          data-testid="scan-folders"
          @click="scans.run()"
        />
        <p class="text-sm text-muted">
          <template v-if="!library.canScan">Add a project folder to scan.</template>
          <template v-else-if="scans.stale">
            You changed folders or options after this scan.
          </template>
          <template v-else>A scan changes nothing.</template>
        </p>
      </div>
    </div>
  </section>
</template>
