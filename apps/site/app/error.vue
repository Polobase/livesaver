<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
await useDocs()
const navigation = useDocsNavigation()
useHead({ title: 'Page not found' })
</script>

<template>
  <UApp>
    <AppHeader :navigation="navigation" />
    <UMain>
      <UContainer class="py-24">
        <UEmpty
          icon="i-lucide-map-pin-off"
          :title="error.statusCode === 404 ? 'There is no page here' : 'Something went wrong'"
          :description="
            error.statusCode === 404
              ? 'The address may be mistyped, or the page was moved.'
              : error.statusMessage || error.message
          "
          :actions="[
            { label: 'To the start', to: '/', color: 'neutral', variant: 'subtle' },
            { label: 'To the guide', to: '/docs/guide/getting-started' },
          ]"
        />
      </UContainer>
    </UMain>
    <AppFooter />
  </UApp>
</template>
