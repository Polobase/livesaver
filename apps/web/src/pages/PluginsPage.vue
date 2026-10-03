<script setup lang="ts">
/** The plug-ins: what the sets use, what is installed, and what can be switched to VST3. */
import type { InstalledRow, PluginUseRow } from '@livesaver/ops'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InstalledTab from '../components/plugins/InstalledTab.vue'
import PluginPanel from '../components/plugins/PluginPanel.vue'
import UpgradeTab from '../components/plugins/UpgradeTab.vue'
import UsesTab from '../components/plugins/UsesTab.vue'
import ScanButton from '../components/scan/ScanButton.vue'
import ScanProgress from '../components/scan/ScanProgress.vue'
import { GET_LIVESAVER } from '../lib/links'
import PagePanel from '../shell/PagePanel.vue'
import { useEngineStore } from '../stores/engine'
import { usePluginsStore } from '../stores/plugins'
import { useScanStore } from '../stores/scan'

const TABS = ['uses', 'installed', 'upgrade'] as const
type Tab = (typeof TABS)[number]

const route = useRoute()
const router = useRouter()
const engines = useEngineStore()
const scans = useScanStore()
const plugins = usePluginsStore()

const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'uses'),
  set: (value) => void router.replace({ query: value === 'uses' ? {} : { tab: value } }),
})
const items = computed(() => {
  const view = scans.scan?.plugins
  return [
    { label: 'In your sets', value: 'uses', badge: view?.uses.length ?? 0 },
    {
      label: 'Installed',
      value: 'installed',
      ...(view?.inventory
        ? { badge: view.installed.filter((plugin) => plugin.device).length }
        : {}),
    },
    {
      label: 'Upgrade to VST3',
      value: 'upgrade',
      ...(plugins.plan ? { badge: plugins.plan.changingSets } : {}),
    },
  ]
})

const use = ref<PluginUseRow>()
const installed = ref<InstalledRow>()
function close(): void {
  use.value = undefined
  installed.value = undefined
}
function toUpgrade(): void {
  close()
  tab.value = 'upgrade'
}
</script>

<template>
  <PagePanel id="plugins" title="Plug-ins" flush>
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
      <div v-if="scans.running && !plugins.review" class="border-b border-default p-4 sm:px-6">
        <ScanProgress :progress="scans.progress" title="Scanning again" />
      </div>
      <UsesTab v-if="tab === 'uses'" :scan="scans.scan" @open="use = $event" />
      <template v-else-if="tab === 'installed'">
        <InstalledTab
          v-if="engines.capabilities.installedPlugins"
          :scan="scans.scan"
          @open="installed = $event"
        />
        <div v-else class="m-auto max-w-lg p-6" data-testid="no-installed">
          <UEmpty
            icon="i-lucide-plug"
            title="What is installed is not known here"
            description="A page in a browser cannot see the plug-ins of your computer. Run “livesaver web”: it opens this app with livesaver behind it, which reads Live's plug-in database and the plug-in folders."
            :actions="[{ ...GET_LIVESAVER, color: 'neutral', variant: 'subtle' }]"
          />
        </div>
      </template>
      <UpgradeTab v-else />

      <PluginPanel
        :scan="scans.scan"
        :use="use"
        :installed="installed"
        @close="close"
        @upgrade="toUpgrade"
      />
    </template>

    <div v-else class="m-auto w-full max-w-md p-6">
      <ScanProgress v-if="scans.running" :progress="scans.progress" title="Scanning your library" />
      <UEmpty
        v-else
        icon="i-lucide-plug"
        title="Nothing scanned yet"
        description="Scan your library to see which plug-ins your sets use, which are missing or run only under Rosetta, and which can be upgraded to VST3."
        :actions="[{ label: 'Set up the scan', to: '/', color: 'neutral', variant: 'subtle' }]"
      />
    </div>
  </PagePanel>
</template>
