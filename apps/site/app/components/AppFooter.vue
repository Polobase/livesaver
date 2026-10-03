<script setup lang="ts">
import { REPOSITORY } from '~/utils/links'

const app = useAppUrl()
</script>

<template>
  <UFooter>
    <template #left>
      <p class="text-sm text-muted">
        MIT licensed. livesaver is not affiliated with or endorsed by Ableton AG; “Ableton” and
        “Live” are trademarks of Ableton AG.
      </p>
    </template>
    <UNavigationMenu
      :items="[
        { label: 'Docs', to: '/docs' },
        { label: 'The app', to: app, external: true },
      ]"
      variant="link"
      aria-label="More"
    />
    <template #right>
      <UButton
        :to="`${REPOSITORY}/issues`"
        target="_blank"
        color="neutral"
        variant="link"
        label="Report a problem"
      />
      <UButton
        :to="REPOSITORY"
        target="_blank"
        icon="i-simple-icons-github"
        color="neutral"
        variant="ghost"
        aria-label="livesaver on GitHub"
      />
    </template>
  </UFooter>
</template>
