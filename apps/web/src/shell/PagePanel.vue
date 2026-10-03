<script setup lang="ts">
/** A page of the app: its title bar with the sidebar switch, and its content. */
import ScrollRegion from '../components/common/ScrollRegion.vue'

defineProps<{
  id: string
  title: string
  /**
   * The content fills the panel edge to edge and scrolls by itself (a table that keeps its
   * header in view), instead of the panel scrolling a padded column.
   */
  flush?: boolean
}>()
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
      <slot name="toolbar" />
      <div v-if="flush" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <slot />
      </div>
      <ScrollRegion v-else :label="title" class="flex flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        <slot />
      </ScrollRegion>
    </main>
  </UDashboardPanel>
</template>
