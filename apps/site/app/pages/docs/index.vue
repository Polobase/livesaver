<script setup lang="ts">
/** The docs at a glance: every section with its pages. */
import { SECTIONS } from '~/utils/navigation'

const { data: docs } = await useDocs()
const titles = computed(() => new Map(docs.value.map((doc) => [doc.path, doc.title])))

useSeoMeta({
  title: 'Docs',
  description:
    'Guides to livesaver, notes on the file formats of Ableton Live, and how it is built.',
})
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Docs"
      description="How to use livesaver, what it knows about the files of Ableton Live, and how it is built and tested."
    />
    <UPageBody>
      <UPageGrid>
        <UPageCard
          v-for="section in SECTIONS"
          :key="section.title"
          :icon="section.icon"
          :title="section.title"
          :description="section.description"
          variant="subtle"
          :ui="{ wrapper: 'flex-none' }"
        >
          <ul class="mt-2 space-y-1.5 text-sm">
            <li v-for="[ path, label ] in section.pages" :key="path">
              <ULink :to="path" class="text-default underline-offset-4 hover:underline">
                {{ label ?? titles.get(path) ?? path }}
              </ULink>
            </li>
          </ul>
        </UPageCard>
      </UPageGrid>
    </UPageBody>
  </UContainer>
</template>
