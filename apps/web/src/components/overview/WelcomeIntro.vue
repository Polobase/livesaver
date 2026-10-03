<script setup lang="ts">
/** The first visit: what livesaver does, in the three steps it does it in. */
import { useEngineStore } from '../../stores/engine'

const engines = useEngineStore()
const STEPS = [
  {
    icon: 'i-lucide-scan-search',
    title: 'Scan',
    text: 'livesaver reads every set and looks for its samples the way Live identifies them: by size and checksum, not by name alone.',
  },
  {
    icon: 'i-lucide-list-checks',
    title: 'Review',
    text: 'You see what is complete, what can be fixed and what is missing, per project and per set, before anything changes.',
  },
  {
    icon: 'i-lucide-wrench',
    title: 'Fix',
    text: "Like Live's Collect All and Save, for all projects at once: with a backup of every set, and an undo.",
  },
]
</script>

<template>
  <section aria-labelledby="welcome">
    <h2 id="welcome" class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
      Keep your Live projects complete
    </h2>
    <p class="mt-1 max-w-2xl text-muted">
      Find the samples your sets have lost, collect the ones that lie outside their project, and see
      what is still missing and where it came from.
      <template v-if="engines.kind === 'browser'">
        This page reads the folders you give it, on your computer{{
          engines.capabilities.fix
            ? '; it changes nothing until you have reviewed a fix.'
            : '; it changes nothing.'
        }}
      </template>
    </p>
    <ol class="mt-6 grid gap-4 sm:grid-cols-3">
      <li
        v-for="(step, index) in STEPS"
        :key="step.title"
        class="rounded-lg border border-default p-4"
      >
        <div class="flex items-center gap-2">
          <span
            class="flex size-7 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted"
          >
            {{ index + 1 }}
          </span>
          <UIcon :name="step.icon" class="size-4 text-muted" />
          <h3 class="font-semibold text-highlighted">{{ step.title }}</h3>
        </div>
        <p class="mt-2 text-sm text-muted">{{ step.text }}</p>
      </li>
    </ol>
  </section>
</template>
