<script setup lang="ts">
/** Every key of the app, to look up: opened with `?`. */
import { SHORTCUTS, shortcutsOpen } from './shortcuts'
</script>

<template>
  <UModal
    v-model:open="shortcutsOpen"
    title="Keyboard shortcuts"
    description="Everything in the app can be reached with the keyboard."
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-5" data-testid="shortcuts">
        <section v-for="group in SHORTCUTS" :key="group.title">
          <h3 class="text-sm font-medium text-muted">{{ group.title }}</h3>
          <dl class="mt-1.5 divide-y divide-default">
            <div
              v-for="shortcut in group.shortcuts"
              :key="shortcut.does"
              class="flex items-center justify-between gap-4 py-1.5 text-sm"
            >
              <dt>{{ shortcut.does }}</dt>
              <dd class="flex shrink-0 items-center gap-1">
                <template v-for="(key, index) in shortcut.keys" :key="key">
                  <span v-if="index > 0 && shortcut.sequence" class="text-xs text-muted">then</span>
                  <UKbd :value="key" />
                </template>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UModal>
</template>
