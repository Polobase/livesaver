<script setup lang="ts">
/** A page of the app: its title bar with the sidebar switch, and its content. */
import { useTemplateRef } from 'vue'
import ScrollRegion from '../components/common/ScrollRegion.vue'
import PageNotices from './PageNotices.vue'

defineProps<{
  id: string
  title: string
  /**
   * The content fills the panel edge to edge and scrolls by itself (a table that keeps its
   * header in view), instead of the panel scrolling a padded column.
   */
  flush?: boolean
}>()

const content = useTemplateRef<{ $el?: HTMLElement }>('content')
/** Back to the top of the page's content: for when it became something else to read. */
defineExpose({ toTop: () => content.value?.$el?.scrollTo({ top: 0 }) })
</script>

<template>
  <UDashboardPanel :id="id">
    <main class="flex min-h-0 flex-1 flex-col">
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
      <PageNotices />
      <slot name="toolbar" />
      <div v-if="flush" class="page-in flex min-h-0 flex-1 flex-col overflow-hidden">
        <slot />
      </div>
      <ScrollRegion
        v-else
        ref="content"
        :label="title"
        class="page-in flex flex-col gap-4 p-4 sm:gap-6 sm:p-6"
      >
        <slot />
      </ScrollRegion>
    </main>
  </UDashboardPanel>
</template>
