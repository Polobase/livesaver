<script setup lang="ts">
/** The whole picture after a scan; before the first one, what livesaver does and what it needs. */
import { nextTick, useTemplateRef, watch } from 'vue'
import LibrarySetup from '../components/library/LibrarySetup.vue'
import FixCard from '../components/overview/FixCard.vue'
import HealthHeadline from '../components/overview/HealthHeadline.vue'
import LibrarySection from '../components/overview/LibrarySection.vue'
import MissingCard from '../components/overview/MissingCard.vue'
import PluginsCard from '../components/overview/PluginsCard.vue'
import RecentRuns from '../components/overview/RecentRuns.vue'
import ReferencesCard from '../components/overview/ReferencesCard.vue'
import ReportsMenu from '../components/overview/ReportsMenu.vue'
import ScanFacts from '../components/overview/ScanFacts.vue'
import ScanNotices from '../components/overview/ScanNotices.vue'
import SourcesCard from '../components/overview/SourcesCard.vue'
import WelcomeIntro from '../components/overview/WelcomeIntro.vue'
import ScanButton from '../components/scan/ScanButton.vue'
import ScanProgress from '../components/scan/ScanProgress.vue'
import PagePanel from '../shell/PagePanel.vue'
import { useEngineStore } from '../stores/engine'
import { useFixStore } from '../stores/fix'
import { useLibraryStore } from '../stores/library'
import { useScanStore } from '../stores/scan'

const engines = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const fix = useFixStore()

// The button that starts the first scan is at the end of a long page: what the scan found is
// read from its top, not from where that button was.
const panel = useTemplateRef<{ toTop: () => void }>('panel')
watch(
  () => scans.scan !== undefined,
  (found) => {
    if (found) void nextTick(() => panel.value?.toTop())
  },
)
</script>

<template>
  <PagePanel id="overview" ref="panel" title="Overview">
    <template #actions>
      <ReportsMenu v-if="scans.scan" :reports="scans.scan.samples.reports" />
      <ScanButton />
    </template>

    <div class="mx-auto w-full max-w-5xl space-y-6">
      <ScanProgress
        v-if="scans.running && !fix.review"
        :progress="scans.progress"
        :title="scans.scan ? 'Scanning again' : 'Scanning your library'"
      />

      <template v-if="scans.scan">
        <ScanNotices :scan="scans.scan" />
        <LibrarySection />
        <HealthHeadline :scan="scans.scan" />
        <div v-if="scans.scan.samples.sets > 0" class="grid gap-4 lg:grid-cols-2">
          <FixCard :scan="scans.scan" />
          <MissingCard :scan="scans.scan" />
        </div>
        <PluginsCard v-if="scans.scan.plugins.counts.used > 0" :scan="scans.scan" />
        <div v-if="scans.scan.samples.sets > 0" class="grid gap-4 lg:grid-cols-2">
          <ReferencesCard :scan="scans.scan" />
          <SourcesCard :rows="scans.scan.samples.foundSources" />
        </div>
        <RecentRuns />
        <ScanFacts :scan="scans.scan" />
      </template>

      <template v-else>
        <WelcomeIntro />
        <UCard>
          <h3 class="text-lg font-semibold text-highlighted">Your library</h3>
          <p class="text-sm text-muted">
            <template v-if="engines.capabilities.paths">
              The folders livesaver knows from your settings. Add the folder with your projects,
              then scan.
            </template>
            <template v-else>
              Give this page the folder with your projects and the folders your samples are in, then
              scan.
            </template>
          </p>
          <LibrarySetup class="mt-5" />
          <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-default pt-5">
            <UButton
              size="lg"
              icon="i-lucide-scan-search"
              label="Scan your library"
              :loading="scans.running"
              :disabled="!library.canScan || scans.running"
              data-testid="scan-library"
              @click="scans.run()"
            />
            <p v-if="!library.canScan" class="text-sm text-muted" data-testid="needs-project">
              Add a project folder to start.
            </p>
            <p v-else class="text-sm text-muted">A scan changes nothing.</p>
          </div>
        </UCard>
        <RecentRuns />
      </template>
    </div>
  </PagePanel>
</template>
