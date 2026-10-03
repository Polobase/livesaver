<script setup lang="ts">
/** The samples in detail: per project, what is missing, every planned change, every set. */
import type { ChangeRow, MissingRow, SetRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChangesTab from '../components/samples/ChangesTab.vue'
import MissingTab from '../components/samples/MissingTab.vue'
import ProjectPanel from '../components/samples/ProjectPanel.vue'
import ProjectsTab from '../components/samples/ProjectsTab.vue'
import RowPanel from '../components/samples/RowPanel.vue'
import SetsTab from '../components/samples/SetsTab.vue'
import ScanButton from '../components/scan/ScanButton.vue'
import ScanProgress from '../components/scan/ScanProgress.vue'
import { projectOf } from '../lib/detail'
import PagePanel from '../shell/PagePanel.vue'
import { useFixStore } from '../stores/fix'
import { useScanStore } from '../stores/scan'

const TABS = ['projects', 'missing', 'changes', 'sets'] as const
type Tab = (typeof TABS)[number]

const route = useRoute()
const router = useRouter()
const scans = useScanStore()
const fix = useFixStore()

/** The tab is part of the address, so a link can lead to it and Back returns to it. */
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'projects'),
  set: (value) => void router.replace({ query: value === 'projects' ? {} : { tab: value } }),
})
const items = computed(() => {
  const samples = scans.scan?.samples
  return [
    { label: 'Projects', value: 'projects', badge: samples?.projectRows.length ?? 0 },
    { label: 'Missing', value: 'missing', badge: samples?.missing.length ?? 0 },
    { label: 'Changes', value: 'changes', badge: samples?.changes.length ?? 0 },
    { label: 'Sets', value: 'sets', badge: samples?.setRows.length ?? 0 },
  ]
})

/** The project, or the set of a project, that is looked at from the side. */
const panel = ref<{ root: string; setPath?: string }>()
const change = ref<ChangeRow>()
const missing = ref<MissingRow>()
/** A search the Changes tab starts with (from a project's panel). */
const changeSearch = ref<string>()

function openSet(set: SetRow): void {
  const project = scans.scan ? projectOf(scans.scan, set) : undefined
  if (project) panel.value = { root: project.root, setPath: set.path }
}

function showChanges(search: string): void {
  panel.value = undefined
  changeSearch.value = search
  tab.value = 'changes'
}
</script>

<template>
  <PagePanel id="samples" title="Samples" flush>
    <template #actions>
      <ScanButton />
    </template>

    <template v-if="scans.scan" #toolbar>
      <UTabs
        v-model="tab"
        :items="items"
        :content="false"
        variant="link"
        class="w-full px-2 sm:px-4"
        :ui="{ list: 'border-b-0' }"
      />
    </template>

    <template v-if="scans.scan">
      <div v-if="scans.running && !fix.review" class="border-b border-default p-4 sm:px-6">
        <ScanProgress :progress="scans.progress" title="Scanning again" />
      </div>
      <ProjectsTab v-if="tab === 'projects'" :scan="scans.scan" @open="panel = { root: $event }" />
      <MissingTab v-else-if="tab === 'missing'" :scan="scans.scan" @open="missing = $event" />
      <ChangesTab
        v-else-if="tab === 'changes'"
        :scan="scans.scan"
        :search="changeSearch"
        @open="change = $event"
      />
      <SetsTab v-else :scan="scans.scan" @open="openSet" />

      <ProjectPanel
        :scan="scans.scan"
        :root="panel?.root"
        :set-path="panel?.setPath"
        @close="panel = undefined"
        @changes="showChanges"
      />
      <RowPanel
        :change="change"
        :missing="missing"
        :base="scans.scan.samples.base"
        @close="
          () => {
            change = undefined
            missing = undefined
          }
        "
      />
    </template>

    <div v-else class="m-auto w-full max-w-md p-6">
      <ScanProgress v-if="scans.running" :progress="scans.progress" title="Scanning your library" />
      <UEmpty
        v-else
        icon="i-lucide-audio-waveform"
        title="Nothing scanned yet"
        description="Scan your library to see every project, what a fix would change, and what is missing."
        :actions="[{ label: 'Set up the scan', to: '/', color: 'neutral', variant: 'subtle' }]"
      />
    </div>
  </PagePanel>
</template>
