<script setup lang="ts">
/** The top of every page: where one is, the docs, the search, and the way into the app. */
import type { NavigationMenuItem } from '@nuxt/ui'
import { REPOSITORY } from '~/utils/links'
import type { NavItem } from '~/utils/navigation'

defineProps<{ navigation: NavItem[] }>()
const route = useRoute()
const app = useAppUrl()

const links = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Guide',
    to: '/docs/guide/getting-started',
    active: route.path.startsWith('/docs/guide'),
  },
  { label: 'File formats', to: '/docs/format', active: route.path.startsWith('/docs/format') },
  {
    label: 'Under the hood',
    to: '/docs/web',
    active: ['/docs/web', '/docs/codemods', '/docs/verification'].some((path) =>
      route.path.startsWith(path),
    ),
  },
])
</script>

<template>
  <UHeader :toggle="{ color: 'neutral', variant: 'ghost' }">
    <!-- The whole left side: the header's own title would wrap the logo's link in a link. -->
    <template #left><AppLogo /></template>

    <UNavigationMenu :items="links" variant="link" aria-label="Sections" />

    <template #right>
      <UContentSearchButton :collapsed="false" class="hidden w-56 lg:inline-flex" />
      <UContentSearchButton class="lg:hidden" />
      <UColorModeButton />
      <UButton
        :to="REPOSITORY"
        target="_blank"
        icon="i-simple-icons-github"
        color="neutral"
        variant="ghost"
        aria-label="livesaver on GitHub"
      />
      <UButton :to="app" external label="Open the app" class="hidden sm:inline-flex" />
    </template>

    <template #body>
      <UButton :to="app" external block label="Open the app" class="mb-4" />
      <UContentNavigation :navigation="navigation" highlight aria-label="Docs" />
    </template>
  </UHeader>
</template>
