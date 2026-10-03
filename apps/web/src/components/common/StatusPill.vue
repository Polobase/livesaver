<script setup lang="ts">
/** A state as an icon of its own shape and colour, with its name in the text colour. */
import { computed } from 'vue'
import { HEALTH, type Health } from '../../lib/health'

const props = defineProps<{ health: Health; label?: string }>()
const look = computed(() => HEALTH[props.health])
</script>

<template>
  <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <UIcon :name="look.icon" class="size-4 shrink-0" :class="look.tone" />
    <span>{{ label ?? look.label }}</span>
  </span>
</template>
