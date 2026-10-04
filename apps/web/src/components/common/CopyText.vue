<script setup lang="ts">
/**
 * A command or an address to take along: shown as it is, with a button that copies it. A page
 * can neither run a command nor link to a browser's own settings, so copying is what is left.
 */
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  text: string
  /** What it is, for the button's name: "the command", "the address". */
  what: string
}>()
const toast = useToast()
const copied = ref(false)
let settle: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    clearTimeout(settle)
    settle = setTimeout(() => {
      copied.value = false
    }, 2500)
  } catch {
    // The text is there to be selected: one click takes all of it.
    toast.add({ title: 'The browser did not allow copying', color: 'error' })
  }
}
onBeforeUnmount(() => clearTimeout(settle))
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-0.5 align-middle" data-testid="copy-text">
    <code class="min-w-0 rounded bg-elevated px-1.5 py-0.5 text-xs break-all select-all">{{
      text
    }}</code>
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :aria-label="`Copy ${what}`"
      @click="copy"
    />
    <!-- Said to someone who does not see the icon change. -->
    <span class="sr-only" role="status">{{ copied ? 'Copied' : '' }}</span>
  </span>
</template>
