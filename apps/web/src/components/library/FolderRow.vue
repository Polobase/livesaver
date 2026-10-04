<script setup lang="ts">
/** One folder of the library: what it is, where it lies, and (for a sample folder) whose it is. */
import { computed, ref } from 'vue'
import type { KnownFolder, LocatedFolder } from '../../engine/types'
import { count } from '../../lib/format'
import { LIVE_CONTENT } from '../../lib/library'
import { useEngineStore } from '../../stores/engine'
import { type FolderKind, useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import { useWritingStore } from '../../stores/writing'
import RevealLink from '../common/RevealLink.vue'

const props = defineProps<{ folder: KnownFolder; kind: FolderKind; disabled?: boolean }>()
const engines = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const writing = useWritingStore()
/** With fixing in the browser switched on: whether the page may write into a project folder. */
const access = computed(() =>
  writing.on && props.kind === 'projects' && !props.folder.waits
    ? (props.folder.access ?? 'read')
    : undefined,
)
const refused = ref('')
/** The browser asks its user, in answer to this click. */
async function allow(): Promise<void> {
  refused.value = ''
  try {
    if ((await library.allowEditing(props.folder.id)) !== 'edit')
      refused.value = 'Your browser did not allow it.'
  } catch (error) {
    refused.value = (error as Error).message
  }
}
/** A folder of the last visit: the browser is asked to let the page read it again. */
async function allowAgain(): Promise<void> {
  refused.value = ''
  try {
    if (!(await library.allow(props.folder.id))) refused.value = 'Your browser did not allow it.'
  } catch (error) {
    refused.value = (error as Error).message
  }
}

const HOW: Record<LocatedFolder['how'], string> = {
  typed: 'as typed',
  found: 'found from your sets',
  unknown: 'location unknown',
}

/** A browser does not know where a folder lies: it is typed, or worked out by a scan. */
const editing = ref(false)
const at = computed(() => library.located.get(props.folder.id))
/** Live's own content lies in the Live app: asked for its path, any path into the app will do. */
const isLive = computed(() => props.folder.holds.includes(LIVE_CONTENT))
const place = computed(() => {
  if (engines.capabilities.paths) return props.folder.path
  const typed = props.folder.path.trim()
  // What was typed may be another folder of the app than this one: the scan says which path
  // it took the folder to have (until the path is changed again).
  if (typed) return at.value?.how === 'typed' && !scans.stale ? at.value.path : typed
  return at.value && at.value.how !== 'unknown' ? at.value.path : ''
})
const how = computed(() => {
  if (engines.capabilities.paths || !at.value || !place.value) return ''
  const typed = props.folder.path.trim()
  if (!typed) return HOW[at.value.how]
  // (Typed as it is shown needs no word; the path of another folder of the app does.)
  return place.value === typed.replace(/(?<=.)\/+$/, '') ? '' : 'from the path you typed'
})
const facts = computed(() =>
  [
    props.folder.files === undefined
      ? ''
      : `${count(props.folder.files)} ${props.folder.files === 1 ? 'file' : 'files'}`,
    ...props.folder.holds,
  ].filter((fact) => fact),
)
/** Live's own content always counts as installed: there is nothing to tick for it. */
const canMark = computed(() => props.kind === 'search' && !isLive.value)
</script>

<template>
  <li class="flex items-start gap-3 px-3 py-2.5" data-testid="folder-row">
    <UIcon
      :name="folder.waits ? 'i-lucide-folder-clock' : 'i-lucide-folder'"
      class="mt-0.5 size-5 shrink-0 text-muted"
    />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span
          class="font-medium"
          :class="folder.waits ? 'text-muted' : 'text-highlighted'"
          data-testid="folder-name"
          >{{
            folder.name
          }}</span
        >
        <span v-if="facts.length" class="text-xs text-muted" data-testid="folder-facts">
          {{ facts.join(' · ') }}
        </span>
      </div>
      <!-- (Where a folder that says what is installed lies, the page works out by itself.) -->
      <div
        v-if="kind !== 'installed'"
        class="flex flex-wrap items-center gap-x-2 text-xs text-muted"
        data-testid="folder-place"
      >
        <span v-if="place" class="break-all" data-testid="folder-path">{{ place }}</span>
        <span v-if="how">({{ how }})</span>
        <span v-if="!folder.exists" class="text-default">This folder does not exist.</span>
        <RevealLink v-else-if="engines.capabilities.paths" :path="folder.path" />
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
      <!-- A folder of the last visit: what a browser lets a page keep of it decides what is left to do. -->
      <div
        v-if="folder.waits"
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        data-testid="folder-waits"
      >
        <template v-if="folder.waits === 'permission'">
          From your last visit. Your browser wants to be asked before this page reads it again.
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            label="Allow"
            :aria-label="`Allow ${folder.name}`"
            :disabled="disabled"
            @click="allowAgain"
          />
          <span v-if="refused" role="alert">{{ refused }}</span>
        </template>
        <template v-else>
          From your last visit: add it again, by the dialog or a drop.
          <template v-if="folder.lost">
            Your browser would keep it, but would then not show
            {{ count(folder.lost) }}
            of its files (it hides some names from a folder it keeps).
          </template>
          <template v-else>A browser hands a page such a folder for one visit.</template>
          What you typed and ticked for it is kept.
        </template>
      </div>
      <div
        v-if="access"
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"
        data-testid="folder-access"
      >
        <template v-if="access === 'edit'">
          <UIcon name="i-lucide-pencil" class="size-3.5 shrink-0" />
          This page may edit it: it can be fixed here.
        </template>
        <template v-else-if="access === 'ask'">
          <UIcon name="i-lucide-eye" class="size-3.5 shrink-0" />
          Can only be read so far.
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            label="Allow editing"
            :disabled="disabled"
            @click="allow"
          />
          <span v-if="refused" role="alert">{{ refused }}</span>
        </template>
        <template v-else>
          <UIcon name="i-lucide-eye" class="size-3.5 shrink-0" />
          Added to be read only. To fix in it, remove it and add it again with “Add folder”.
        </template>
      </div>
      <UInput
        v-if="editing"
        :model-value="folder.path"
        size="sm"
        class="w-full"
        :placeholder="
          isLive
            ? 'Any path into the Live app, e.g. /Applications/Ableton Live 12 Suite.app'
            : 'Where the folder lies on disk, e.g. /Users/you/Music'
        "
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
