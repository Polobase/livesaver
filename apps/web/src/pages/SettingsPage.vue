<script setup lang="ts">
/** The library and how it is scanned, and what livesaver found on this computer. */
import LibrarySetup from '../components/library/LibrarySetup.vue'
import ScanButton from '../components/scan/ScanButton.vue'
import PagePanel from '../shell/PagePanel.vue'
import { useEngineStore } from '../stores/engine'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const scans = useScanStore()
</script>

<template>
  <PagePanel id="settings" title="Settings">
    <template #actions>
      <ScanButton />
    </template>
    <div class="mx-auto w-full max-w-5xl space-y-6">
      <section aria-labelledby="library-title">
        <h2 id="library-title" class="text-lg font-semibold text-highlighted">Library</h2>
        <p class="text-sm text-muted">
          The folders a scan reads and how it matches.
          <template v-if="scans.stale">
            You changed them after the last scan: scan again to see what the changes do.
          </template>
        </p>
        <LibrarySetup class="mt-4" />
      </section>

      <section aria-labelledby="appearance-title">
        <h2 id="appearance-title" class="text-lg font-semibold text-highlighted">Appearance</h2>
        <div class="mt-3 flex items-center gap-3">
          <UColorModeSelect class="w-40" aria-label="Appearance" />
          <span class="text-sm text-muted">Light, dark, or as your system is set.</span>
        </div>
      </section>

      <section aria-labelledby="about-title">
        <h2 id="about-title" class="text-lg font-semibold text-highlighted">This app</h2>
        <dl class="mt-3 grid max-w-xl grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
          <dt class="text-muted">Runs</dt>
          <dd>
            {{
              engines.kind === 'computer'
                ? 'on this computer, with livesaver behind it'
                : 'in this browser, on its own (read-only)'
            }}
          </dd>
          <template v-if="engines.start?.version">
            <dt class="text-muted">livesaver</dt>
            <dd>{{ engines.start.version }}</dd>
          </template>
          <template v-if="engines.kind === 'computer'">
            <dt class="text-muted">Ableton Live</dt>
            <dd>{{ engines.start?.live || 'not found' }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </PagePanel>
</template>
