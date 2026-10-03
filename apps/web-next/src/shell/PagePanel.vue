<script setup lang="ts">
/** A page of the app: its title bar with the sidebar switch, and its content. */
defineProps<{ id: string; title: string }>()
</script>

<template>
  <UDashboardPanel :id="id">
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
      <slot name="toolbar" />
    </template>

    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
