<script setup lang="ts">
/**
 * Whether everything is ready for a fix that the page itself makes. A browser sees less than
 * livesaver on the computer: what it cannot check, its user confirms.
 */
import { computed, ref, watchEffect } from 'vue'
import { bytes } from '../../lib/format'
import type { FixPlan } from '../../lib/plan'
import { isReady, pageReadiness } from '../../lib/ready'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'

defineProps<{ plan: FixPlan }>()
const ready = defineModel<boolean>('ready', { required: true })
const library = useLibraryStore()
const scans = useScanStore()

/** Ableton Live is closed: the page cannot see it, so it is asked. */
const liveClosed = ref(false)
const folders = computed(() =>
  scans.scanned && scans.scan
    ? pageReadiness(scans.scanned, scans.scan, library)
    : { ask: [], readOnly: [], unplaced: [], places: [] },
)
const editable = computed(() => folders.value.ask.length + folders.value.readOnly.length === 0)
watchEffect(() => {
  ready.value = isReady(folders.value) && liveClosed.value
})

const problem = ref('')
/** The browser asks its user once per folder, in answer to this click. */
async function allow(): Promise<void> {
  problem.value = ''
  try {
    for (const folder of folders.value.ask) await library.allowEditing(folder.id)
  } catch (error) {
    problem.value = (error as Error).message
  }
}
const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(', ')
</script>

<template>
  <ul class="space-y-3" data-testid="review-ready">
    <li class="flex gap-3" data-testid="ready-editable">
      <UIcon
        :name="editable ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
        class="mt-0.5 size-5 shrink-0"
        :class="editable ? 'text-(--status-fine)' : 'text-(--status-missing)'"
      />
      <div class="space-y-1">
        <p class="font-medium text-highlighted">
          {{
            editable
              ? 'This page may edit your project folders'
              : 'This page may not edit your project folders yet'
          }}
        </p>
        <p v-if="editable" class="text-sm text-muted">
          It writes into them through your browser, and nowhere else.
        </p>
        <template v-else>
          <p v-if="folders.ask.length" class="text-sm text-muted">
            {{ quoted(folders.ask.map((folder) => folder.name)) }}
            can only be read so far.
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              label="Allow editing"
              data-testid="allow-editing"
              @click="allow"
            />
          </p>
          <p v-if="folders.readOnly.length" class="text-sm text-muted">
            {{ quoted(folders.readOnly) }}
            {{ folders.readOnly.length === 1 ? 'was' : 'were' }} added to be read only. In the
            Settings, remove {{ folders.readOnly.length === 1 ? 'it' : 'them' }}, add
            {{ folders.readOnly.length === 1 ? 'it' : 'them' }} again with “Add folder”, and scan.
          </p>
          <p v-if="problem" class="text-sm" role="alert">{{ problem }}</p>
        </template>
      </div>
    </li>
    <li class="flex gap-3" data-testid="ready-placed">
      <UIcon
        :name="folders.unplaced.length ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
        class="mt-0.5 size-5 shrink-0"
        :class="folders.unplaced.length ? 'text-(--status-missing)' : 'text-(--status-fine)'"
      />
      <div>
        <p class="font-medium text-highlighted">
          {{
            folders.unplaced.length
              ? 'It is not known where a folder lies on your disk'
              : 'It is known where your folders lie on your disk'
          }}
        </p>
        <p class="text-sm text-muted">
          <template v-if="folders.unplaced.length">
            A fix writes into the sets where their files are, and a browser does not tell a page
            where a folder lies. In the Settings, set the path of
            {{ quoted(folders.unplaced) }}, and scan again.
          </template>
          <template v-else>
            A fix writes into the sets where their files are. A browser does not tell a page where a
            folder lies, so look whether this is right; the path can be set in the Settings.
          </template>
        </p>
        <ul v-if="!folders.unplaced.length" class="mt-1 space-y-0.5 text-sm" data-testid="places">
          <li v-for="at in folders.places" :key="at.id" class="break-all">
            <span class="font-medium text-highlighted">{{ at.name }}</span>
            <span class="text-muted">
              lies at {{ at.path }} ({{ at.how === 'typed' ? 'as you typed' : 'as its sets say' }})
            </span>
          </li>
        </ul>
      </div>
    </li>
    <li class="flex gap-3">
      <UIcon
        :name="liveClosed ? 'i-lucide-circle-check' : 'i-lucide-circle-help'"
        class="mt-0.5 size-5 shrink-0"
        :class="liveClosed ? 'text-(--status-fine)' : 'text-muted'"
      />
      <div class="space-y-1.5">
        <p class="font-medium text-highlighted">Is Ableton Live closed?</p>
        <p class="text-sm text-muted">
          A page cannot see whether Live is running. A set that is open in Live must not be
          rewritten under it: quit Live first.
        </p>
        <UCheckbox v-model="liveClosed" label="Ableton Live is closed" data-testid="live-closed" />
      </div>
    </li>
    <li class="flex gap-3">
      <UIcon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-muted" />
      <div>
        <p class="font-medium text-highlighted">Room for the copies</p>
        <p class="text-sm text-muted">
          The copies need {{ bytes(plan.copyBytes) }}. A page cannot see how much is free where your
          projects lie.
        </p>
      </div>
    </li>
    <li class="flex gap-3">
      <UIcon name="i-lucide-circle-check" class="mt-0.5 size-5 shrink-0 text-(--status-fine)" />
      <div>
        <p class="font-medium text-highlighted">Backups and undo</p>
        <p class="text-sm text-muted">
          Each set is copied to its project’s Backup folder before it is rewritten, as Live does.
          What the undo needs is kept by this browser, for this site: it is gone if you clear the
          site’s data. The backups stay.
        </p>
      </div>
    </li>
  </ul>
</template>
