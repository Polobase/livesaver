<script setup lang="ts">
/**
 * Shows a file or folder in Finder (File Explorer on Windows), where livesaver can do that (a page on its own cannot): a
 * link beside a path, or a button of its own.
 */
import { computed } from 'vue'
import { splitPath } from '../../lib/format'
import { platform } from '../../lib/platform'
import { useEngineStore } from '../../stores/engine'

const props = defineProps<{ path: string; label?: string; button?: boolean }>()
const engines = useEngineStore()
const toast = useToast()
const label = computed(() => props.label ?? `Show in ${platform.fileManager}`)
/** Several of these stand in one list: each says what it shows. */
const name = computed(() => `${label.value}: ${splitPath(props.path).name || props.path}`)

async function reveal(): Promise<void> {
  try {
    await engines.engine().reveal(props.path)
  } catch (error) {
    toast.add({
      title: 'It could not be shown',
      description: (error as Error).message,
      color: 'error',
    })
  }
}
</script>

<template>
  <UButton
    v-if="engines.capabilities.reveal && path"
    v-bind="
      button
        ? { size: 'sm', variant: 'subtle', icon: 'i-lucide-folder-search' }
        : { size: 'xs', variant: 'link', class: 'p-0 underline' }
    "
    color="neutral"
    :label="label"
    :aria-label="name"
    data-testid="reveal"
    @click="reveal"
  />
</template>
