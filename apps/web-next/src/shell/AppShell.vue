<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useEngineStore } from '../stores/engine'
import AppLogo from './AppLogo.vue'
import { PLACES, type Place, SETTINGS } from './navigation'

const router = useRouter()
const engine = useEngineStore()
onMounted(() => engine.load())

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

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
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
      <template #header="{ collapsed }">
        <AppLogo :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />
        <UNavigationMenu :collapsed="collapsed" :items="main" orientation="vertical" tooltip />
        <UNavigationMenu
          :collapsed="collapsed"
          :items="secondary"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <UColorModeButton v-if="collapsed" />
        <div v-else class="flex w-full items-center justify-between gap-2">
          <UTooltip :text="where.note">
            <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted" data-testid="where">
              <UIcon :name="where.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ where.label }}</span>
            </span>
          </UTooltip>
          <UColorModeButton />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" placeholder="Search or jump to…" />

    <RouterView />
  </UDashboardGroup>
</template>
