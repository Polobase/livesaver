<script setup lang="ts">
/** The report files of the scan, as the command line writes them, to save. */
import { computed } from 'vue'
import { download, REPORT_TITLES } from '../../lib/download'

const props = defineProps<{ reports: Readonly<Record<string, string>> }>()
const items = computed(() =>
  Object.keys(REPORT_TITLES)
    .filter((name) => name in props.reports)
    .map((name) => ({
      label: REPORT_TITLES[name] as string,
      description: name,
      icon: name.endsWith('.csv') ? 'i-lucide-file-spreadsheet' : 'i-lucide-file-text',
      onSelect: () => download(name, props.reports[name] as string),
    })),
)
</script>

<template>
  <UDropdownMenu v-if="items.length" :items="items" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-download"
      label="Reports"
      data-testid="reports"
    />
  </UDropdownMenu>
</template>
