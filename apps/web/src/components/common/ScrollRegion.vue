<script setup lang="ts">
/**
 * A part of the page that scrolls. It can take the keyboard's focus, so that someone without a
 * mouse can scroll it with the arrow keys: content that scrolls out of reach is content they
 * cannot read. (Hence a tabindex on an element that does nothing else, which a linter would
 * rather not see.)
 */
defineProps<{ label: string }>()
</script>

<template>
  <section
    :aria-label="label"
    tabindex="0"
    class="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-border-accented)"
  >
    <slot />
  </section>
</template>
