<script setup lang="ts">
/**
 * Choosing a folder of this computer in the page. A browser's own folder dialog hands a page the
 * files but never the folder's path, and the path is what livesaver on this computer needs; so
 * livesaver lists the folders, and the page shows them.
 */
import { ref, watch } from 'vue'
import type { FolderListing, Place } from '../../engine/types'
import { useEngineStore } from '../../stores/engine'

const props = defineProps<{ title: string; start: string; places: readonly Place[] }>()
const emit = defineEmits<{ choose: [folder: FolderListing] }>()
const open = defineModel<boolean>('open', { required: true })
const engines = useEngineStore()

const listing = ref<FolderListing>()
const typed = ref('')
const problem = ref('')
const loading = ref(false)

/** Counts what was asked for: of two listings on their way, only the one asked for last counts. */
let asked = 0

async function go(path: string): Promise<void> {
  const mine = ++asked
  const written = typed.value
  problem.value = ''
  loading.value = true
  try {
    const next = await engines.engine().folders(path)
    // A listing that takes long (a large folder, a drive that wakes up) arrives after one that
    // was asked for later: it is no longer wanted.
    if (mine !== asked) return
    listing.value = next
    // The path that is shown follows the listing, unless someone is typing another one.
    if (typed.value === written) typed.value = next.path
  } catch (error) {
    if (mine === asked) problem.value = (error as Error).message
  } finally {
    if (mine === asked) loading.value = false
  }
}

// Opened where it starts, each time anew.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    listing.value = undefined
    typed.value = props.start
    void go(props.start)
  },
  { immediate: true },
)

function choose(): void {
  if (!listing.value) return
  emit('choose', listing.value)
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    description="Click through the folders of this computer, or paste a path."
    :ui="{ content: 'sm:max-w-xl', body: 'space-y-3' }"
  >
    <template #body>
      <form class="flex gap-2" @submit.prevent="go(typed)">
        <UInput
          v-model="typed"
          class="flex-1"
          aria-label="Path of the folder"
          placeholder="Type or paste a path"
          autocomplete="off"
          spellcheck="false"
          icon="i-lucide-folder-open"
        />
        <!-- Never disabled: while a listing is on its way, a path can be typed and opened
             (Enter in the field does nothing if the form's button is disabled). -->
        <UButton
          type="submit"
          color="neutral"
          variant="subtle"
          label="Open"
          :trailing-icon="loading ? 'i-lucide-loader-circle' : undefined"
          :ui="{ trailingIcon: 'animate-spin' }"
        />
      </form>
      <ul class="flex flex-wrap gap-1.5" aria-label="Places">
        <li v-for="place in places" :key="place.path">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            :label="place.name"
            @click="go(place.path)"
          />
        </li>
      </ul>
      <UAlert
        v-if="problem"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="This folder cannot be opened"
        :description="problem"
        role="alert"
      />
      <ul
        class="max-h-72 divide-y divide-default overflow-y-auto rounded-md border border-default"
        aria-label="Folders in this folder"
      >
        <li v-if="listing?.parent">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
            @click="go(listing.parent)"
          >
            <UIcon name="i-lucide-corner-left-up" class="size-4 shrink-0 text-muted" />
            Up
          </button>
        </li>
        <li v-for="folder in listing?.folders" :key="folder.path">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
            data-testid="browser-item"
            @click="go(folder.path)"
          >
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ folder.name }}</span>
          </button>
        </li>
        <li v-if="listing && listing.folders.length === 0" class="px-3 py-2 text-sm text-muted">
          No folders in here.
        </li>
      </ul>
    </template>
    <template #footer="{ close }">
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Add this folder" :disabled="!listing" @click="choose" />
      </div>
    </template>
  </UModal>
</template>
