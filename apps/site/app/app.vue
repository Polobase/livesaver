<script setup lang="ts">
import type { ContentSearchFile } from '@nuxt/ui'

await useDocs()
const navigation = useDocsNavigation()

// The text of every doc, for the search: fetched when the search is first opened.
const { data: files, execute } = useLazyFetch<ContentSearchFile[]>('/search.json', {
  immediate: false,
  server: false,
  default: () => [],
})
const { open } = useContentSearch()
watch(open, (isOpen) => {
  if (isOpen && files.value.length === 0) void execute()
})

// A page is there before its buttons work: it is drawn from the HTML, then the script takes
// over. A test waits for that (`data-ready`) before it presses anything.
const ready = ref(false)
onMounted(() => {
  ready.value = true
})

const route = useRoute()
const site = useRuntimeConfig().public.siteUrl
useHead({
  htmlAttrs: { 'data-ready': () => (ready.value ? 'true' : undefined) },
  titleTemplate: (title) => (title ? `${title} · livesaver` : 'livesaver'),
  // One address per page: the one with the slash at its end, as the host serves it.
  link: [{ rel: 'canonical', href: () => `${site}${route.path.replace(/\/+$/, '')}/` }],
})
useSeoMeta({
  ogSiteName: 'livesaver',
  ogType: 'website',
  ogImage: `${site}/docs/guide/images/overview-light.webp`,
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <AppHeader :navigation="navigation" />
    <UMain>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </UMain>
    <AppFooter />
    <ClientOnly>
      <LazyUContentSearch
        :files="files"
        :navigation="navigation"
        placeholder="Search the docs…"
        :fuse="{ resultLimit: 30 }"
      />
    </ClientOnly>
  </UApp>
</template>
