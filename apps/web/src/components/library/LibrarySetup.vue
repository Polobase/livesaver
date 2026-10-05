<script setup lang="ts">
/** The folders of a scan and how it matches: the same on the first visit and in the settings. */
import { computed, ref } from 'vue'
import { plural } from '../../lib/format'
import { absentWords, PLUGIN_DATABASE, PLUGIN_FOLDER } from '../../lib/library'
import { liveGuideOpen } from '../../shell/guide'
import { useEngineStore } from '../../stores/engine'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import { useWritingStore } from '../../stores/writing'
import FolderAccessInfo from './FolderAccessInfo.vue'
import FolderList from './FolderList.vue'
import ScanOptions from './ScanOptions.vue'

const engines = useEngineStore()
const library = useLibraryStore()
/**
 * `plugins`: also the folders that say what is installed (the settings; not the first visit).
 * `compact`: looked at again after a scan, where what a first visit explains is kept short.
 */
defineProps<{ plugins?: boolean; compact?: boolean }>()
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
/** Folders of the last visit that are not there: said before a scan is made without them. */
const absent = computed(() =>
  absentWords(
    library.absent.map((folder) => folder.name),
    false,
    library.projects.some((folder) => folder.waits === 'folder'),
  ),
)
</script>

<template>
  <div class="space-y-4">
    <!-- Before a folder is handed over: what that means, and that nothing leaves the computer. -->
    <FolderAccessInfo v-if="!onComputer" :compact="compact" />
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
    <UAlert
      v-if="library.absent.length"
      color="neutral"
      variant="subtle"
      icon="i-lucide-folder-clock"
      :title="absent.title"
      :description="absent.text"
      role="status"
      data-testid="absent"
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
                Live's own content: drag the Ableton Live app here from your Applications folder.
                <!-- (On the grey of this box the usual grey of a link is too faint.) -->
                <UButton
                  class="p-0 text-default underline"
                  color="neutral"
                  variant="link"
                  size="sm"
                  label="Show me how"
                  data-testid="show-live-guide"
                  @click="liveGuideOpen = true"
                />
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
    <ScanOptions :disabled="scans.running || !engines.start" />
  </div>
</template>
