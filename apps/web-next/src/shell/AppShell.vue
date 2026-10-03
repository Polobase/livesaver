<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from './AppLogo.vue'
import { PLACES, type Place, SETTINGS } from './navigation'

const router = useRouter()
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
          <span class="text-xs text-muted">Nothing leaves this computer.</span>
          <UColorModeButton />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" placeholder="Search or jump to…" />

    <RouterView />
  </UDashboardGroup>
</template>
