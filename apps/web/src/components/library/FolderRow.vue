<script setup lang="ts">
/** One folder of the library: what it is, where it lies, and (for a sample folder) whose it is. */
import { computed, ref } from 'vue'
import type { KnownFolder, LocatedFolder } from '../../engine/types'
import { count } from '../../lib/format'
import { LIVE_CONTENT } from '../../lib/library'
import { useEngineStore } from '../../stores/engine'
import { type FolderKind, useLibraryStore } from '../../stores/library'

const props = defineProps<{ folder: KnownFolder; kind: FolderKind; disabled?: boolean }>()
const engines = useEngineStore()
const library = useLibraryStore()

const HOW: Record<LocatedFolder['how'], string> = {
  typed: 'as typed',
  found: 'found from your sets',
  unknown: 'location unknown',
}

/** A browser does not know where a folder lies: it is typed, or worked out by a scan. */
const editing = ref(false)
const at = computed(() => library.located.get(props.folder.id))
const place = computed(() => {
  if (engines.capabilities.paths) return props.folder.path
  const typed = props.folder.path.trim()
  return typed || (at.value && at.value.how !== 'unknown' ? at.value.path : '')
})
const how = computed(() =>
  !engines.capabilities.paths && !props.folder.path.trim() && at.value && place.value
    ? HOW[at.value.how]
    : '',
)
const facts = computed(() =>
  [
    props.folder.files === undefined
      ? ''
      : `${count(props.folder.files)} ${props.folder.files === 1 ? 'file' : 'files'}`,
    ...props.folder.holds,
  ].filter((fact) => fact),
)
/** Live's own content always counts as installed: there is nothing to tick for it. */
const canMark = computed(
  () => props.kind === 'search' && !props.folder.holds.includes(LIVE_CONTENT),
)
</script>

<template>
  <li class="flex items-start gap-3 px-3 py-2.5" data-testid="folder-row">
    <UIcon name="i-lucide-folder" class="mt-0.5 size-5 shrink-0 text-muted" />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="font-medium text-highlighted" data-testid="folder-name">{{
          folder.name
        }}</span>
        <span v-if="facts.length" class="text-xs text-muted" data-testid="folder-facts">
          {{ facts.join(' · ') }}
        </span>
      </div>
      <div
        class="flex flex-wrap items-center gap-x-2 text-xs text-muted"
        data-testid="folder-place"
      >
        <span v-if="place" class="break-all">{{ place }}</span>
        <span v-if="how">({{ how }})</span>
        <span v-if="!folder.exists" class="text-default">This folder does not exist.</span>
        <UButton
          v-if="!engines.capabilities.paths"
          variant="link"
          color="neutral"
          size="xs"
          class="p-0 underline"
          :disabled="disabled"
          :label="editing ? 'Done' : place ? 'Change path' : 'Set path'"
          @click="editing = !editing"
        />
      </div>
      <UInput
        v-if="editing"
        :model-value="folder.path"
        size="sm"
        class="w-full"
        placeholder="Where the folder lies on disk, e.g. /Users/you/Music"
        :aria-label="`Path of ${folder.name} on disk`"
        autocomplete="off"
        spellcheck="false"
        :disabled="disabled"
        @update:model-value="library.update(folder.id, { path: String($event) })"
      />
      <UTooltip
        v-if="canMark"
        text="Libraries installed by a vendor, such as Native Instruments. Vendors re-saved some of their files slightly larger; in such a folder livesaver accepts those when the audio is the same."
      >
        <UCheckbox
          :model-value="folder.vendor"
          size="sm"
          label="Contains installed libraries"
          :disabled="disabled"
          @update:model-value="library.update(folder.id, { vendor: $event === true })"
        />
      </UTooltip>
    </div>
    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="`Remove ${folder.name}`"
      :disabled="disabled"
      @click="library.remove(kind, folder.id)"
    />
  </li>
</template>
