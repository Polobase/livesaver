<script setup lang="ts">
/**
 * The project folders, or the sample folders. On this computer a folder is added by its path; in
 * a browser it is handed over, through the folder upload or by a drop. The browser's own folder
 * dialog (File System Access API) is used for one thing only, a project folder that is to be
 * fixed in the page: only its handles can write, but they hide files with certain names.
 */
import { editableFromDrop, foldersFromDrop, foldersFromFiles } from '@livesaver/web'
import { computed, ref, useTemplateRef } from 'vue'
import { keepsDroppedFolders, pickFolderToEdit } from '../../engine/storage'
import type { FolderListing } from '../../engine/types'
import { count } from '../../lib/format'
import { useEngineStore } from '../../stores/engine'
import { type FolderKind, useLibraryStore } from '../../stores/library'
import { useWritingStore } from '../../stores/writing'
import FolderBrowser from './FolderBrowser.vue'
import FolderRow from './FolderRow.vue'

const props = defineProps<{ kind: FolderKind; title: string; hint: string; disabled?: boolean }>()
const engines = useEngineStore()
const library = useLibraryStore()
const writing = useWritingStore()
const folders = computed(() =>
  props.kind === 'projects'
    ? library.projects
    : props.kind === 'search'
      ? library.search
      : library.installed,
)
/** With fixing in the browser switched on, a project folder is handed over to be edited. */
const forEditing = computed(() => props.kind === 'projects' && writing.on)

// --- on this computer: by path
const browsing = ref(false)
const start = computed(
  () => library.projects.at(-1)?.path ?? library.suggested[0] ?? engines.start?.home ?? '',
)
// (Only a browser is handed folders that say what is installed.)
const add = (folder: FolderListing) => {
  if (props.kind !== 'installed') library.addPath(props.kind, folder)
}

/**
 * Nothing is added before the engine has said what the page starts with: the folders of the
 * last visit are put in place then, over whatever the lists hold. (A browser may take a moment
 * to hand them back; a folder added in that moment was lost, and written over the others.)
 */
const locked = computed(() => props.disabled || !engines.start)

// --- in a browser: handed over
const input = useTemplateRef<HTMLInputElement>('input')
const dragging = ref(false)
/** Files listed so far of a folder that is being dropped. */
const reading = ref<number>()
/** The folder upload is open, or the browser is listing what was chosen. */
const listing = ref(false)
const problem = ref('')

async function pick(): Promise<void> {
  if (locked.value) return
  problem.value = ''
  if (forEditing.value) {
    try {
      const chosen = await pickFolderToEdit()
      if (chosen) library.addSources(props.kind, [chosen])
    } catch (error) {
      problem.value = `The folder could not be opened: ${(error as Error).message || String(error)}`
    }
    return
  }
  // The browser lists every file of the folder before it hands them over, and reports nothing
  // meanwhile: seconds for a large folder.
  listing.value = true
  input.value?.click()
}

function picked(event: Event): void {
  const target = event.target as HTMLInputElement
  listing.value = false
  if (!locked.value) library.addSources(props.kind, foldersFromFiles(target.files ?? []))
  target.value = ''
}

async function drop(event: DragEvent): Promise<void> {
  dragging.value = false
  if (locked.value || engines.capabilities.paths || !event.dataTransfer) return
  problem.value = ''
  reading.value = 0
  try {
    // (The drop is read before anything is waited for: it cannot be read later.) A folder that
    // is to be edited is listed too: a drop shows every file, its handle hides some.
    const take = forEditing.value ? editableFromDrop : foldersFromDrop
    const dropped = await take(event.dataTransfer.items, (files) => {
      reading.value = files
    })
    library.addSources(props.kind, dropped)
  } catch (error) {
    problem.value = `The folder could not be read: ${(error as Error).message || String(error)}`
  } finally {
    reading.value = undefined
  }
}

/**
 * Why a drop is the better way where a browser hands out a handle with it: a project folder
 * that is to be edited is read in full, and any folder is kept for the next visit.
 */
const dropHint = computed(() =>
  forEditing.value
    ? 'or drop it here: a dropped folder is read in full'
    : keepsDroppedFolders()
      ? 'or drop a folder here: your browser keeps a dropped folder for your next visit'
      : 'or drop a folder here',
)
const waiting = computed(() =>
  !engines.start
    ? 'one moment…'
    : reading.value !== undefined
      ? `listing… ${count(reading.value)} files`
      : listing.value
        ? 'a large folder takes a few seconds to appear…'
        : dropHint.value,
)
</script>

<template>
  <section
    :aria-labelledby="`${kind}-title`"
    class="rounded-lg border border-default transition-colors"
    :class="dragging ? 'border-(--ui-primary) bg-elevated/60' : ''"
    :data-testid="`${kind}-folders`"
    @dragover.prevent="dragging = !engines.capabilities.paths"
    @dragleave="dragging = false"
    @drop.prevent="drop"
  >
    <header class="px-4 pt-4">
      <h3 :id="`${kind}-title`" class="font-semibold text-highlighted">{{ title }}</h3>
      <p class="mt-0.5 text-sm text-muted">{{ hint }}</p>
    </header>
    <ul v-if="folders.length" class="mt-3 divide-y divide-default border-y border-default">
      <FolderRow
        v-for="folder in folders"
        :key="folder.id"
        :folder="folder"
        :kind="kind"
        :disabled="disabled"
      />
    </ul>
    <div class="flex flex-wrap items-center gap-3 p-4">
      <template v-if="engines.capabilities.paths">
        <UButton
          icon="i-lucide-folder-plus"
          color="neutral"
          variant="subtle"
          label="Add folder"
          :disabled="disabled || !engines.start"
          @click="browsing = true"
        />
        <FolderBrowser
          v-model:open="browsing"
          :title="kind === 'projects' ? 'Add a project folder' : 'Add a sample folder'"
          :start="start"
          :places="engines.start?.places ?? []"
          @choose="add"
        />
      </template>
      <template v-else>
        <UButton
          icon="i-lucide-folder-plus"
          color="neutral"
          variant="subtle"
          label="Add folder"
          :disabled="locked"
          @click="pick"
        />
        <span class="text-sm text-muted" data-testid="folder-waiting">{{ waiting }}</span>
        <input
          ref="input"
          type="file"
          multiple
          hidden
          webkitdirectory
          :disabled="locked"
          :data-testid="`${kind}-input`"
          @change="picked"
          @cancel="listing = false"
        >
      </template>
    </div>
    <UAlert
      v-if="problem"
      class="mx-4 mb-4"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="problem"
      role="alert"
    />
    <slot />
  </section>
</template>
