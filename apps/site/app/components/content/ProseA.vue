<script setup lang="ts">
/**
 * A link in a doc. The docs link to each other as files (`fileref.md`), which is what works on
 * GitHub; here such a link leads to the page.
 */
import ProseA from '@nuxt/ui/runtime/components/prose/A.vue'
import { docHref } from '~/utils/links'

const props = defineProps<{ href?: string; target?: '_blank' | '_self' | '_parent' | '_top' }>()
const stem = inject<Ref<string>>('doc-stem', ref(''))
const to = computed(() => docHref(props.href ?? '', stem.value))
const outside = computed(() => /^https?:/.test(to.value))
</script>

<template>
  <ProseA :href="to" :target="outside ? '_blank' : target"><slot /></ProseA>
</template>
