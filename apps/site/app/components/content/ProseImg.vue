<script setup lang="ts">
/**
 * A picture in a doc, from where it lies beside the doc. A screenshot taken in light has a twin
 * taken in dark, which is shown when the site is dark.
 */
import { darkTwin, docImage } from '~/utils/links'

const props = defineProps<{
  src: string
  alt?: string
  width?: string | number
  height?: string | number
}>()
const stem = inject<Ref<string>>('doc-stem', ref(''))
const base = useRuntimeConfig().app.baseURL.replace(/\/$/, '')
const light = computed(() => `${base}${docImage(props.src, stem.value)}`)
const dark = computed(() => darkTwin(light.value))
</script>

<template>
  <span class="my-6 block overflow-hidden rounded-lg ring ring-default">
    <UColorModeImage
      v-if="dark"
      :light="light"
      :dark="dark"
      :alt="alt ?? ''"
      :width="width ?? 1280"
      :height="height ?? 800"
      loading="lazy"
      class="block h-auto w-full"
    />
    <img
      v-else
      :src="light"
      :alt="alt ?? ''"
      :width="width"
      :height="height"
      loading="lazy"
      class="block h-auto w-full"
    >
  </span>
</template>
