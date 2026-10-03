<script setup lang="ts">
/** The folders of a scan and how it matches: the same on the first visit and in the settings. */
import { computed } from 'vue'
import { useEngineStore } from '../../stores/engine'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import FolderList from './FolderList.vue'
import ScanOptions from './ScanOptions.vue'

const engines = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const onComputer = computed(() => engines.capabilities.paths)
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-4 lg:grid-cols-2">
      <FolderList
        kind="projects"
        title="Projects"
        hint="Folders with your Live projects. Every set in them is scanned."
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
    <p v-if="!onComputer" class="text-sm text-muted">
      Your browser may ask whether to "upload" a folder. Nothing is uploaded: the files are only
      read by this page, on your computer.
    </p>
    <ScanOptions :disabled="scans.running" />
  </div>
</template>
