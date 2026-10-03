<script setup lang="ts">
await useDocs()
const navigation = useDocsNavigation()
</script>

<template>
  <UContainer>
    <UPage>
      <template #left>
        <UPageAside>
          <UContentNavigation :navigation="navigation" highlight aria-label="Docs" />
        </UPageAside>
      </template>
      <slot />
    </UPage>
  </UContainer>
</template>
