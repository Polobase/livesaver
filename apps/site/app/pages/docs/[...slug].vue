<script setup lang="ts">
/** A doc: a Markdown file of the repository's `docs/`, as a page. */
import type { ContentSurroundLink } from '@nuxt/ui'
import { REPOSITORY } from '~/utils/links'
import { sectionOf, surroundOf } from '~/utils/navigation'

definePageMeta({ layout: 'docs' })

const route = useRoute()
// A static host may add a slash to the address of a page.
const path = route.path.replace(/\/+$/, '')
const { data: page } = await useAsyncData(`doc:${path}`, () =>
  queryCollection('docs').path(path).first(),
)
if (!page.value)
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })

const { data: docs } = await useDocs()
// The first page has nothing before it and the last nothing after: the place stays empty, so
// that "next" is always on the same side.
const surround = computed(
  () =>
    surroundOf(path, docs.value).map((doc) =>
      doc ? { title: doc.title, description: doc.description ?? '', path: doc.path } : undefined,
    ) as ContentSurroundLink[],
)
/** The file below `docs/`, without `.md`: links and pictures in it are relative to it. */
const stem = computed(() => (page.value?.stem ?? '').replace(/^docs\//, ''))
provide('doc-stem', stem)

useSeoMeta({
  title: page.value.title,
  description: page.value.description,
  ogTitle: `${page.value.title} · livesaver`,
  ogDescription: page.value.description,
})

const links = computed(() => [
  {
    icon: 'i-lucide-pencil',
    label: 'Edit this page',
    to: `${REPOSITORY}/edit/main/docs/${stem.value}.md`,
    target: '_blank',
  },
  {
    icon: 'i-lucide-message-circle-warning',
    label: 'Report a problem',
    to: `${REPOSITORY}/issues`,
    target: '_blank',
  },
])
</script>

<template>
  <UPage v-if="page">
    <!-- The doc brings its own title and first words: it is one text, here and on GitHub. -->
    <UPageBody>
      <p class="mb-3 text-sm font-semibold text-muted">{{ sectionOf(path)?.title }}</p>
      <ContentRenderer :value="page" />
      <USeparator />
      <UContentSurround :surround="surround" />
    </UPageBody>

    <template #right>
      <!-- A heading is read whole: a list of headings cut off after two words tells little. -->
      <UContentToc
        :links="page.body?.toc?.links ?? []"
        title="On this page"
        highlight
        :ui="{ linkText: 'whitespace-normal' }"
      >
        <template #bottom>
          <USeparator v-if="page.body?.toc?.links?.length" type="dashed" class="my-2" />
          <UPageLinks title="This page" :links="links" :ui="{ linkLabel: 'whitespace-normal' }" />
        </template>
      </UContentToc>
    </template>
  </UPage>
</template>
