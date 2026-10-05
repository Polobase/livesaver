<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ReviewSheet from '../components/fix/ReviewSheet.vue'
import AddLiveGuide from '../components/library/AddLiveGuide.vue'
import UpgradeSheet from '../components/plugins/UpgradeSheet.vue'
import { bytes, plural } from '../lib/format'
import { GUIDE } from '../lib/links'
import { TAKEN_OUT } from '../lib/runs'
import { useEngineStore } from '../stores/engine'
import { useFixStore } from '../stores/fix'
import { useHistoryStore } from '../stores/history'
import { useLibraryStore } from '../stores/library'
import { usePluginsStore } from '../stores/plugins'
import { useScanStore } from '../stores/scan'
import AppLogo from './AppLogo.vue'
import { PLACES, type Place, SETTINGS } from './navigation'
import ShortcutsHelp from './ShortcutsHelp.vue'
import { shortcutsOpen } from './shortcuts'
import WhereDialog from './WhereDialog.vue'
import { whereOpen } from './where'

const router = useRouter()
const route = useRoute()
const toast = useToast()
const engine = useEngineStore()
const library = useLibraryStore()
const scans = useScanStore()
const fix = useFixStore()
const plugins = usePluginsStore()
const history = useHistoryStore()

/** What the engine starts with: its folders, the scan it kept, the last fix that can be undone. */
onMounted(async () => {
  await engine.load()
  if (!engine.start) return
  library.init(engine.start)
  scans.restore(engine.start.last)
  plugins.restore(engine.start.last?.upgrade)
  await history.refresh()
})

/**
 * A scan that is started in the Settings is watched where its result is read: the page goes to
 * the Overview, instead of staying where nothing tells what the scan found.
 */
watch(
  () => scans.running,
  (running) => {
    if (running && route.path === '/settings') void router.push('/')
  },
)

/**
 * What a fix or an undo did is said on the Overview. Fixed from another page (one project, from
 * its panel), a toast says it there, with the undo within reach.
 */
const elsewhere = () => route.path !== '/'
watch(
  () => fix.review,
  (review, before) => {
    const fixed = fix.fixed
    // Closed to undo it at once (the result's own button): that is said when it is undone.
    if (review || !before || !fixed || fix.undoing || !elsewhere()) return
    toast.add({
      title: `Fixed: ${plural(fixed.sets, 'set')} rewritten, ${plural(fixed.files, 'file')} copied${fixed.bytes ? ` (${bytes(fixed.bytes)})` : ''}`,
      icon: 'i-lucide-circle-check',
      // Long enough to reach for the undo.
      duration: 12_000,
      actions: [
        ...(fixed.run && engine.capabilities.undo
          ? [
              {
                label: 'Undo',
                icon: 'i-lucide-undo-2',
                color: 'neutral' as const,
                variant: 'outline' as const,
                onClick: () => void fix.undo(fixed.run),
              },
            ]
          : []),
        {
          label: 'History',
          color: 'neutral' as const,
          variant: 'ghost' as const,
          onClick: () => void router.push('/history'),
        },
      ],
    })
  },
)
watch(
  () => fix.undone,
  (undone) => {
    if (!undone || !elsewhere()) return
    toast.add({
      title: `Undone: ${plural(undone.restored, 'set')} restored, ${plural(undone.trashed, 'file')} ${TAKEN_OUT[engine.kind]}`,
      icon: 'i-lucide-undo-2',
      ...(undone.changedSince.length + undone.problems.length
        ? { description: 'Not everything could be taken back: the Overview says what was left.' }
        : {}),
    })
  },
)
watch(
  () => fix.failure,
  (failure) => {
    // A fix that failed says so in its review; this is for an undo started from a toast.
    if (!failure || fix.review || !elsewhere()) return
    toast.add({ title: 'It did not work', description: failure.message, color: 'error' })
  },
)

// Something nobody expected is said, not swallowed: the app goes on, and the user knows.
onErrorCaptured((error) => {
  console.error(error)
  toast.add({
    title: 'Something went wrong',
    description: (error as Error).message || String(error),
    color: 'error',
  })
  return false
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
        icon: engine.paired ? 'i-lucide-link' : 'i-lucide-monitor',
        note: engine.paired
          ? 'This page is connected to livesaver on this computer, which reads and writes your files. Nothing leaves this computer.'
          : 'livesaver reads and writes your files here. Nothing leaves this computer.',
      }
    : {
        label: 'In this browser',
        icon: 'i-lucide-globe',
        note: engine.capabilities.fix
          ? 'The page reads the folders you give it, and fixes in those you chose for editing. Nothing leaves this computer.'
          : 'The page reads the folders you give it and changes nothing. Nothing leaves this computer.',
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
  {
    label: 'Keyboard shortcuts',
    icon: 'i-lucide-keyboard',
    kbds: ['?'],
    onSelect: () => {
      shortcutsOpen.value = true
    },
  },
  { label: 'Guide', icon: 'i-lucide-book-open', to: GUIDE.start, target: '_blank' },
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

defineShortcuts({
  ...Object.fromEntries(
    [...PLACES, SETTINGS].map((place) => [
      place.keys.join('-').toLowerCase(),
      () => router.push(place.to),
    ]),
  ),
  '?': () => {
    shortcutsOpen.value = true
  },
})
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
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="min-w-0 p-0 text-muted"
              :icon="where.icon"
              :label="where.label"
              data-testid="where"
              @click="whereOpen = true"
            />
          </UTooltip>
          <div class="flex shrink-0 items-center">
            <UTooltip text="The guide (opens the site)">
              <UButton
                :to="GUIDE.start"
                target="_blank"
                icon="i-lucide-book-open"
                color="neutral"
                variant="ghost"
                aria-label="Guide"
              />
            </UTooltip>
            <UTooltip text="Keyboard shortcuts" :kbds="['?']">
              <UButton
                icon="i-lucide-keyboard"
                color="neutral"
                variant="ghost"
                aria-label="Keyboard shortcuts"
                @click="shortcutsOpen = true"
              />
            </UTooltip>
            <UColorModeButton />
          </div>
        </footer>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" placeholder="Search or jump to…" />

    <RouterView />
    <ReviewSheet />
    <UpgradeSheet />
    <ShortcutsHelp />
    <WhereDialog v-model:open="whereOpen" />
    <AddLiveGuide />
  </UDashboardGroup>
</template>
