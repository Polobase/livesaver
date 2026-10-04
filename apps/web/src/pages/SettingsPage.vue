<script setup lang="ts">
/** The library and how it is scanned, and what livesaver found on this computer. */
import { computed, ref } from 'vue'
import RevealLink from '../components/common/RevealLink.vue'
import LibrarySetup from '../components/library/LibrarySetup.vue'
import WritingSwitch from '../components/library/WritingSwitch.vue'
import ScanButton from '../components/scan/ScanButton.vue'
import { disconnect } from '../engine/create'
import PagePanel from '../shell/PagePanel.vue'
import { shortcutsOpen } from '../shell/shortcuts'
import { useEngineStore } from '../stores/engine'
import { useLibraryStore } from '../stores/library'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const toast = useToast()

const resetting = ref(false)
async function reset(): Promise<void> {
  resetting.value = true
  try {
    library.init(await engines.reset())
    toast.add({
      title: 'The folders and options are those of your settings again',
      icon: 'i-lucide-rotate-ccw',
    })
  } catch (error) {
    toast.add({
      title: 'The settings could not be reset',
      description: (error as Error).message,
      color: 'error',
    })
  } finally {
    resetting.value = false
  }
}

/** Where things are on this computer; what is not there is said, not left out. */
const found = computed(() => {
  const at = engines.start?.found
  if (!at) return []
  return [
    { label: 'Ableton Live', text: engines.start?.live || 'not found', path: '' },
    { label: 'User Library', text: at.userLibrary || 'not found', path: at.userLibrary },
    { label: 'Factory Packs', text: at.factoryPacks || 'not found', path: at.factoryPacks },
    {
      label: 'Live’s own content',
      text: at.coreLibrary || 'not found',
      path: at.coreLibrary,
    },
    {
      label: 'Settings file',
      text: at.config || 'none: livesaver uses what it found on this computer',
      path: at.config,
    },
    { label: 'Runs and originals', text: at.state, path: at.state },
  ]
})
</script>

<template>
  <PagePanel id="settings" title="Settings">
    <template #actions>
      <ScanButton />
    </template>
    <div class="mx-auto w-full max-w-5xl space-y-8">
      <section aria-labelledby="library-title">
        <h2 id="library-title" class="text-lg font-semibold text-highlighted">Library</h2>
        <p class="text-sm text-muted">
          The folders a scan reads and how it matches.
          <template v-if="scans.stale">
            You changed them after the last scan: scan again to see what the changes do.
          </template>
        </p>
        <LibrarySetup class="mt-4" plugins />
        <div
          v-if="engines.capabilities.ownSettings"
          class="mt-5 flex flex-wrap items-center gap-3 border-t border-default pt-4"
        >
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-rotate-ccw"
            label="Reset to the command line’s settings"
            :loading="resetting"
            :disabled="resetting || scans.running"
            data-testid="reset-settings"
            @click="reset"
          />
          <p class="max-w-xl text-sm text-muted">
            The app starts with the folders and options of its last scan. A reset goes back to those
            of the command line: your settings file, and what livesaver found on this computer. No
            file is touched.
          </p>
        </div>
      </section>

      <WritingSwitch v-if="engines.kind === 'browser'" />

      <section aria-labelledby="appearance-title">
        <h2 id="appearance-title" class="text-lg font-semibold text-highlighted">Appearance</h2>
        <div class="mt-3 flex items-center gap-3">
          <UColorModeSelect class="w-40" aria-label="Appearance" />
          <span class="text-sm text-muted">Light, dark, or as your system is set.</span>
        </div>
      </section>

      <section aria-labelledby="keyboard-title">
        <h2 id="keyboard-title" class="text-lg font-semibold text-highlighted">Keyboard</h2>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-keyboard"
            label="Show the shortcuts"
            @click="shortcutsOpen = true"
          />
          <span class="text-sm text-muted">
            Everything can be reached with the keyboard. Press <UKbd value="?" /> anywhere to see
            the keys.
          </span>
        </div>
      </section>

      <section v-if="found.length" aria-labelledby="found-title" data-testid="found">
        <h2 id="found-title" class="text-lg font-semibold text-highlighted">On this computer</h2>
        <p class="text-sm text-muted">What livesaver found, and where it keeps its own files.</p>
        <dl class="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
          <template v-for="item in found" :key="item.label">
            <dt class="text-muted">{{ item.label }}</dt>
            <dd class="min-w-0">
              <span class="break-all" :class="item.path ? '' : 'text-muted'">{{ item.text }}</span>
              <RevealLink v-if="item.path" :path="item.path" class="ms-2" />
            </dd>
          </template>
        </dl>
      </section>

      <section aria-labelledby="about-title">
        <h2 id="about-title" class="text-lg font-semibold text-highlighted">This app</h2>
        <dl class="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
          <dt class="text-muted">Runs</dt>
          <dd>
            {{
              engines.kind !== 'computer'
                ? engines.capabilities.fix
                  ? 'in this browser, on its own: it reads the folders you give it, and fixes in those you chose for editing'
                  : 'in this browser, on its own: it reads the folders you give it and changes nothing'
                : engines.paired
                  ? 'in this page, connected to livesaver on this computer: it reads and writes your files'
                  : 'on this computer, with livesaver behind it: it reads and writes your files'
            }}
            <UButton
              v-if="engines.paired"
              size="xs"
              color="neutral"
              variant="link"
              class="p-0 underline"
              label="Disconnect"
              @click="disconnect()"
            />
          </dd>
          <template v-if="engines.start?.version">
            <dt class="text-muted">livesaver</dt>
            <dd>{{ engines.start.version }}</dd>
          </template>
          <dt class="text-muted">Your data</dt>
          <dd>Nothing leaves this computer: the app asks no other server for anything.</dd>
        </dl>
      </section>
    </div>
  </PagePanel>
</template>
