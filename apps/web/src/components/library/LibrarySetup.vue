<script setup lang="ts">
/** The folders of a scan and how it matches: the same on the first visit and in the settings. */
import { computed, ref } from 'vue'
import { keepsDroppedFolders } from '../../engine/storage'
import { plural } from '../../lib/format'
import { PLUGIN_DATABASE, PLUGIN_FOLDER } from '../../lib/library'
import { useEngineStore } from '../../stores/engine'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import { useWritingStore } from '../../stores/writing'
import FolderList from './FolderList.vue'
import ScanOptions from './ScanOptions.vue'

const engines = useEngineStore()
const library = useLibraryStore()
/** `plugins`: also the folders that say what is installed (the settings; not the first visit). */
defineProps<{ plugins?: boolean }>()
const scans = useScanStore()
const writing = useWritingStore()
const onComputer = computed(() => engines.capabilities.paths)

/** Folders of the last visit that the browser wants to be asked for again: all at one click. */
const refused = ref('')
async function allowAll(): Promise<void> {
  refused.value = ''
  for (const folder of [...library.asleep]) {
    try {
      if (!(await library.allow(folder.id)))
        refused.value = `Your browser did not allow “${folder.name}”.`
    } catch (error) {
      // (A browser may want a click of its own for every folder: each row has its button.)
      refused.value = (error as Error).message
    }
  }
}
const keepsDrops = keepsDroppedFolders()
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="library.asleep.length"
      color="neutral"
      variant="subtle"
      icon="i-lucide-folder-clock"
      :title="`${plural(library.asleep.length, 'folder')} from your last visit`"
      :description="
        refused ||
        (library.asleep.length === 1
          ? 'Your browser kept it for this page, and wants to be asked before the page reads it again.'
          : 'Your browser kept them for this page, and wants to be asked before the page reads them again.')
      "
      role="status"
      data-testid="asleep"
      :actions="[
        {
          label: library.asleep.length === 1 ? 'Allow it' : 'Allow them',
          color: 'neutral',
          variant: 'subtle',
          disabled: scans.running,
          onClick: allowAll,
        },
      ]"
    />
    <div class="grid gap-4 lg:grid-cols-2">
      <FolderList
        kind="projects"
        title="Projects"
        :hint="
          writing.on
            ? 'Folders with your Live projects. Every set in them is scanned. Your browser asks whether this page may edit a folder: a fix writes into it.'
            : 'Folders with your Live projects. Every set in them is scanned.'
        "
        :disabled="scans.running"
      >
        <div
          v-if="onComputer && library.projects.length === 0 && library.suggested.length"
          class="mx-4 mb-4 rounded-md bg-elevated/60 p-3 text-sm"
        >
          <p class="text-muted">Checked before on this computer:</p>
          <ul class="mt-1 space-y-1">
            <li v-for="path in library.suggested" :key="path" class="flex items-center gap-2">
              <span class="min-w-0 break-all">{{ path }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="subtle"
                label="Add it"
                @click="library.addPath('projects', { path, holds: [] })"
              />
            </li>
          </ul>
        </div>
      </FolderList>
      <FolderList
        kind="search"
        title="Sample folders"
        :hint="
          onComputer
            ? 'Where livesaver looks for missing samples. The project folders are searched as well.'
            : 'Where to look for missing samples: sample folders, the User Library, Factory Packs, installed libraries. The project folders are searched as well.'
        "
        :disabled="scans.running"
      >
        <div
          v-if="library.wanted.libraries || library.wanted.live"
          class="mx-4 mb-4 rounded-md bg-elevated/60 p-3 text-sm"
          data-testid="wanted"
        >
          <p class="text-muted">Not added yet:</p>
          <ul class="mt-1 list-disc space-y-1 ps-5">
            <li v-if="library.wanted.libraries">
              your User Library and Factory Packs: the folder
              <code class="text-xs">Music/Ableton</code>
              in your home folder;
            </li>
            <li v-if="library.wanted.live">
              <template v-if="onComputer">
                Live's own content: the Core Library in the Ableton Live app (in the app:
                <code class="text-xs">Contents/App-Resources/Core Library</code>).
              </template>
              <template v-else>
                Live's own content: drag the Ableton Live app here from your Applications folder
                (the folder dialog cannot open an app).
              </template>
            </li>
          </ul>
        </div>
      </FolderList>
    </div>
    <FolderList
      v-if="plugins && !onComputer"
      kind="installed"
      title="Installed plug-ins"
      hint="Optional. A page cannot see what is installed on your computer, but you can show it: with these folders, the scan says which plug-ins of your sets are missing or run only under Rosetta."
      :disabled="scans.running"
    >
      <div
        v-if="!library.installedHolds.has(PLUGIN_FOLDER) || !library.installedHolds.has(PLUGIN_DATABASE)"
        class="mx-4 mb-4 rounded-md bg-elevated/60 p-3 text-sm"
        data-testid="wanted-installed"
      >
        <p class="text-muted">Not added yet:</p>
        <ul class="mt-1 list-disc space-y-1 ps-5">
          <li v-if="!library.installedHolds.has(PLUGIN_FOLDER)">
            your plug-ins: the folder <code class="text-xs">/Library/Audio/Plug-Ins</code> (and
            <code class="text-xs">Library/Audio/Plug-Ins</code>
            in your home folder, if you have plug-ins there);
          </li>
          <li v-if="!library.installedHolds.has(PLUGIN_DATABASE)">
            Live's plug-in database: the folder
            <code class="text-xs">Library/Application Support/Ableton/Live Database</code>
            in your home folder. It knows the VST plug-ins by their ids; without it most of them
            cannot be recognised.
          </li>
        </ul>
        <p class="mt-2 text-muted">
          The Library of your home folder is hidden: in the folder dialog, press
          <UKbd value="meta" /> <UKbd value="shift" /> <UKbd value="G" /> and type the path,
          starting with <code class="text-xs">~/Library</code>.
        </p>
      </div>
    </FolderList>
    <p v-if="!onComputer" class="text-sm text-muted" data-testid="kept-note">
      Your browser may ask whether to "upload" a folder. Nothing is uploaded: the files are only
      read by this page, on your computer. This browser keeps the list of your folders for your next
      visit, with what you typed and ticked.
      <template v-if="keepsDrops">
        A folder you dropped here{{ writing.on ? ', or chose for editing,' : '' }}
        is read again then; {{ writing.on ? 'a sample folder' : 'one' }} you chose with “Add folder”
        has to be added again.
      </template>
      <template v-else>The folders themselves have to be added again then.</template>
      <template v-if="writing.on">
        A project folder is chosen for editing instead, and your browser hides files with some names
        in it (a “/” as Finder shows it, or a space at the start or end of the name): samples named
        like that count as missing.
      </template>
    </p>
    <ScanOptions :disabled="scans.running" />
  </div>
</template>
