<script setup lang="ts">
import { computed, ref } from 'vue'
import { GET_LIVESAVER } from '../../lib/links'
/**
 * Fixing in the browser, for a page that has no livesaver behind it: an experiment its user
 * switches on, after reading what a page cannot do that livesaver on the computer can.
 */
import { platform } from '../../lib/platform'
import { browserFacts, waysOf } from '../../lib/ways'
import { useLibraryStore } from '../../stores/library'
import { useWritingStore } from '../../stores/writing'
import CopyText from '../common/CopyText.vue'

const writing = useWritingStore()
const library = useLibraryStore()
/** A browser that edits folders only after a step in its own settings (Brave) is told which. */
const way = computed(() => waysOf(browserFacts()).edit)
/** The limits are shown, and wait to be read. */
const asking = ref(false)
const understood = ref(false)

const LIMITS = [
  {
    title: 'It cannot see whether Ableton Live is running.',
    text: 'Quit Live before every fix and every undo: a set that is open in Live must not be rewritten under it.',
  },
  // (Finder keeps tags and comments with a file: there is no such thing to lose on Windows.)
  ...(platform.finderTags
    ? [
        {
          title: 'A rewritten set loses its Finder tags and its Finder comment.',
          text: 'To macOS, the set a browser writes is a new file.',
        },
      ]
    : []),
  {
    title: 'The undo is kept by this browser, for this site.',
    text: 'It is gone if you clear the site’s data, and another browser does not have it. The backup of every set in its project’s Backup folder stays.',
  },
  {
    title: 'Your browser hides files with some names from a page.',
    text: `A name with ${platform.hiddenNames}. Drop your project folder instead of choosing it with “Add folder”, and this page sees such files all the same. It cannot make one: a sample that would be copied to such a name is left where it is.`,
  },
  {
    title: 'A page has no Trash.',
    text: 'What an undo takes out of a project goes to a hidden folder, “.livesaver-trash”, in your project folder.',
  },
  {
    title: 'It cannot see how much room is left on your disk.',
    text: 'The review says how much the copies need.',
  },
]

function toggle(on: boolean): void {
  if (!on) {
    void writing.set(false)
    return
  }
  understood.value = false
  asking.value = true
}

async function switchOn(): Promise<void> {
  asking.value = false
  await writing.set(true)
}
</script>

<template>
  <section aria-labelledby="writing-title" data-testid="writing">
    <h2 id="writing-title" class="text-lg font-semibold text-highlighted">
      Fixing in this browser
    </h2>
    <template v-if="writing.possible">
      <p class="text-sm text-muted">
        An experiment. Chrome and Edge can let a page edit a folder you choose, so this page can fix
        samples and upgrade plug-ins on its own: with a backup of every set, and an undo. It has
        limits that livesaver on your computer does not have.
      </p>
      <USwitch
        class="mt-3"
        :model-value="writing.on"
        label="Fix in this browser (experimental)"
        :description="
          writing.on
            ? 'On. Project folders are chosen for editing from now on.'
            : 'Off. This page only reads.'
        "
        data-testid="writing-switch"
        @update:model-value="toggle"
      />
      <p
        v-if="writing.on && library.projects.some((folder) => folder.access === 'read')"
        class="mt-3 text-sm text-muted"
        role="note"
      >
        The project folders you added before can only be read. To fix in one, remove it and add it
        again with “Add folder”.
      </p>
    </template>
    <div v-else class="space-y-3" data-testid="writing-impossible">
      <p class="max-w-2xl text-sm text-muted">
        This browser does not let a page edit a folder, so this page only reads. Chrome and Edge do.
        In every browser, <code class="text-xs">livesaver web</code> on your computer fixes, with a
        backup of every set and an undo.
      </p>
      <p v-if="way.address" class="max-w-2xl text-sm" data-testid="writing-step">
        {{ way.text }} The switch is then in this place.
        <span class="mt-1 block">
          The flag: <CopyText :text="way.address" what="the address of the flag" />
        </span>
      </p>
      <UButton v-bind="GET_LIVESAVER" size="sm" color="neutral" variant="subtle" />
    </div>

    <UModal
      v-model:open="asking"
      title="Fix in this browser?"
      description="An experiment. Read what a page cannot do before you switch it on."
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <ul class="space-y-3 text-sm" data-testid="writing-limits">
          <li v-for="limit in LIMITS" :key="limit.title" class="flex gap-2.5">
            <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0 text-muted" />
            <p>
              <span class="font-medium text-highlighted">{{ limit.title }}</span>
              {{ limit.text }}
            </p>
          </li>
        </ul>
        <p class="mt-4 text-sm text-muted">
          <code class="text-xs">livesaver web</code>
          on your computer has none of these limits.
        </p>
        <UCheckbox
          v-model="understood"
          class="mt-4"
          label="I have read this, and I try it on a copy of a project first"
          data-testid="writing-understood"
        />
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="asking = false" />
        <UButton
          icon="i-lucide-wrench"
          label="Switch it on"
          :disabled="!understood"
          data-testid="writing-confirm"
          @click="switchOn"
        />
      </template>
    </UModal>
  </section>
</template>
