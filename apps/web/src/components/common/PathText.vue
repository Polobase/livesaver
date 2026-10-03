<script setup lang="ts">
/**
 * A path in one line. The end of a path says the most, so the folders give way first and the
 * name stays; the whole path is the tooltip.
 */
import { computed } from 'vue'
import { splitPath } from '../../lib/format'

const props = defineProps<{ path: string; plain?: boolean }>()
const parts = computed(() => splitPath(props.path))
const separator = computed(() => props.path.charAt(parts.value.folder.length))
</script>

<template>
  <span class="flex min-w-0 max-w-full" :title="path">
    <span v-if="parts.folder" class="truncate text-muted">{{ parts.folder }}{{ separator }}</span>
    <span class="shrink-0 max-w-full truncate" :class="plain ? '' : 'text-default'">
      {{ parts.name }}
    </span>
  </span>
</template>
