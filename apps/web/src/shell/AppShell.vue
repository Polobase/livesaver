<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ReviewSheet from '../components/fix/ReviewSheet.vue'
import UpgradeSheet from '../components/plugins/UpgradeSheet.vue'
import { useEngineStore } from '../stores/engine'
import { useFixStore } from '../stores/fix'
import { useLibraryStore } from '../stores/library'
import { usePluginsStore } from '../stores/plugins'
import { useScanStore } from '../stores/scan'
import AppLogo from './AppLogo.vue'
import { PLACES, type Place, SETTINGS } from './navigation'

const router = useRouter()
const engine = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const fix = useFixStore()
const plugins = usePluginsStore()

/** What the engine starts with: its folders, the scan it kept, the last fix that can be undone. */
onMounted(async () => {
  await engine.load()
  if (!engine.start) return
  library.init(engine.start)
  scans.restore(engine.start.last)
  plugins.restore(engine.start.last?.upgrade)
  await Promise.all([fix.refreshLast(), plugins.refreshLast()])
})

// A folder dropped beside the lists must not make the browser leave the page for it.
const swallow = (event: DragEvent) => event.preventDefault()
onMounted(() => {
  window.addEventListener('dragover', swallow)
  window.addEventListener('drop', swallow)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', swallow)
  window.removeEventListener('drop', swallow)
})

/** Where the app runs: it decides what the app can do, so it is always in view. */
const where = computed(() =>
  engine.kind === 'computer'
    ? {
        label: 'On this computer',
        icon: 'i-lucide-monitor',
        note: 'livesaver reads and writes your files here. Nothing leaves this computer.',
      }
    : {
        label: 'In this browser',
        icon: 'i-lucide-globe',
        note: 'The page reads the folders you give it and changes nothing. Nothing leaves this computer.',
      },
)
/** The sidebar as a drawer on narrow screens. */
const open = ref(false)

const item = (place: Place): NavigationMenuItem => ({
  label: place.label,
  icon: place.icon,
  to: place.to,
  onSelect: () => {
    open.value = false
  },
})
const main = computed(() => PLACES.map(item))
const secondary = computed(() => [item(SETTINGS)])

/** What can be done from anywhere, for the palette: only what is possible right now. */
const actions = computed<CommandPaletteItem[]>(() => [
  ...(library.canScan && !scans.running
    ? [
        {
          label: scans.scan ? 'Scan again' : 'Scan',
          icon: 'i-lucide-scan-search',
          onSelect: () => void scans.run(),
        },
      ]
    : []),
  ...(engine.capabilities.fix && (scans.scan?.samples.changingSets ?? 0) > 0 && !scans.running
    ? [
        {
          label: 'Review and fix',
          icon: 'i-lucide-list-checks',
          onSelect: () => {
            void router.push('/')
            fix.open()
          },
        },
      ]
    : []),
])

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  ...(actions.value.length ? [{ id: 'do', label: 'Do', items: actions.value }] : []),
  {
    id: 'go',
    label: 'Go to',
    // Chosen with Enter as well as by click, so the palette goes there itself.
    items: [...PLACES, SETTINGS].map((place) => ({
      label: place.label,
      icon: place.icon,
      kbds: [...place.keys],
      onSelect: () => router.push(place.to),
    })),
  },
])

defineShortcuts(
  Object.fromEntries(
    [...PLACES, SETTINGS].map((place) => [
      place.keys.join('-').toLowerCase(),
      () => router.push(place.to),
    ]),
  ),
)
</script>

<template>
  <UDashboardGroup unit="rem" storage="local">
    <UDashboardSidebar
      id="main"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <!-- Everything in the sidebar lies in a landmark: assistive technology jumps between them. -->
      <template #header="{ collapsed }">
        <header><AppLogo :collapsed="collapsed" /></header>
      </template>

      <template #default="{ collapsed }">
        <search>
          <UDashboardSearchButton
            :collapsed="collapsed"
            class="w-full bg-transparent ring-default"
          />
        </search>
        <UNavigationMenu
          :collapsed="collapsed"
          :items="main"
          orientation="vertical"
          tooltip
          aria-label="Places"
        />
        <UNavigationMenu
          :collapsed="collapsed"
          :items="secondary"
          orientation="vertical"
          tooltip
          class="mt-auto"
          aria-label="Settings"
        />
      </template>

      <template #footer="{ collapsed }">
        <footer v-if="collapsed"><UColorModeButton /></footer>
        <footer v-else class="flex w-full items-center justify-between gap-2">
          <UTooltip :text="where.note">
            <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted" data-testid="where">
              <UIcon :name="where.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ where.label }}</span>
            </span>
          </UTooltip>
          <UColorModeButton />
        </footer>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" placeholder="Search or jump to…" />

    <RouterView />
    <ReviewSheet />
    <UpgradeSheet />
  </UDashboardGroup>
</template>
