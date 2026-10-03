<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()
</script>

<template>
  <RouterLink to="/" class="flex items-center gap-2.5 px-1 py-1.5" aria-label="livesaver: overview">
    <svg viewBox="0 0 32 32" class="size-7 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="7" class="fill-(--ui-primary)" />
      <path
        d="M8.5 16.8l5 5 10-11.2"
        fill="none"
        class="stroke-(--ui-bg)"
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="!collapsed" class="text-base font-semibold tracking-tight text-highlighted">
      livesaver
    </span>
  </RouterLink>
</template>
