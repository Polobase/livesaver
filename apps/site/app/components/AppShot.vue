<script setup lang="ts">
/**
 * A picture of the app, in the colours the site is in, framed like a window. The pictures are
 * those of the guides (`docs/guide/images`, taken by `screenshots.ts`).
 */
const props = defineProps<{
  /** `overview`, `review`, … */
  name: string
  alt: string
  /** The first picture of a page is loaded at once; the others when they come into view. */
  eager?: boolean
}>()
const base = useRuntimeConfig().app.baseURL
const src = (scheme: 'light' | 'dark') => `${base}docs/guide/images/${props.name}-${scheme}.webp`
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xl ring ring-default">
    <UColorModeImage
      :light="src('light')"
      :dark="src('dark')"
      :alt="alt"
      width="1280"
      height="800"
      :loading="eager ? 'eager' : 'lazy'"
      class="h-auto w-full"
    />
  </div>
</template>
