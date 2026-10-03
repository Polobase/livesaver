<script setup lang="ts">
/** The state of a plug-in as an icon of its own shape and colour, with its name in the text colour. */
import type { PluginState } from '@livesaver/ops'
import { computed } from 'vue'
import { PLUGIN_STATE } from '../../lib/plugins'

const props = defineProps<{ state: PluginState }>()
const look = computed(() => PLUGIN_STATE[props.state])
</script>

<template>
  <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <UIcon :name="look.icon" class="size-4 shrink-0" :class="look.tone" />
    <span>{{ look.label }}</span>
  </span>
</template>
