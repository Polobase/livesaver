<script setup lang="ts">
/**
 * What has to be said before the numbers: what the last fix or undo did, what the scan could not
 * see, and that the page was changed since.
 */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { bytes, count, plural, when } from '../../lib/format'
import { useEngineStore } from '../../stores/engine'
import { useFixStore } from '../../stores/fix'
import { useScanStore } from '../../stores/scan'

const props = defineProps<{ scan: Scan }>()
const engines = useEngineStore()
const fix = useFixStore()
const scans = useScanStore()

const busy = computed(() => scans.running || fix.running || fix.undoing)
const some = (items: readonly string[], limit = 5) =>
  items.length > limit
    ? [...items.slice(0, limit), `and ${count(items.length - limit)} more`]
    : items

/** A fix from before the page was loaded, or the one before the fix that was just undone. */
const earlier = computed(() => (fix.fixed ? undefined : fix.last))
const liveAdvice = computed(() =>
  engines.capabilities.paths
    ? 'Add the Core Library of your Live app to the sample folders (in the app: Contents/App-Resources/Core Library), and scan again.'
    : 'Drag the Ableton Live app from your Applications folder onto the sample folders, and scan again.',
)
</script>

<template>
  <div class="space-y-3" data-testid="notices">
    <UAlert
      v-if="fix.failure"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="It did not work"
      :description="fix.failure.message"
      role="alert"
      :actions="
        fix.failure.run
          ? [
              {
                label: 'Undo what it did',
                color: 'neutral',
                variant: 'subtle',
                disabled: busy,
                onClick: () => void fix.undo(fix.failure?.run ?? ''),
              },
            ]
          : []
      "
      close
      @update:open="fix.dismiss()"
    />

    <UAlert
      v-if="fix.fixed"
      color="neutral"
      variant="subtle"
      :icon="fix.fixed.errors.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
      :ui="{ icon: fix.fixed.errors.length ? 'text-(--status-missing)' : 'text-(--status-fine)' }"
      role="status"
      data-testid="fixed"
      :actions="
        fix.fixed.run
          ? [
              {
                label: 'Undo this fix',
                icon: 'i-lucide-undo-2',
                color: 'neutral',
                variant: 'subtle',
                disabled: busy,
                loading: fix.undoing,
                onClick: () => void fix.undo(fix.fixed?.run ?? ''),
              },
            ]
          : []
      "
      close
      @update:open="fix.dismiss()"
    >
      <template #title>
        Fixed: {{ plural(fix.fixed.sets, 'set') }} rewritten, {{ plural(fix.fixed.files, 'file') }}
        copied<template v-if="fix.fixed.bytes"> ({{ bytes(fix.fixed.bytes) }})</template>.
      </template>
      <template v-if="fix.fixed.errors.length" #description>
        <p>Not written:</p>
        <ul class="list-disc ps-5">
          <li v-for="item in some(fix.fixed.errors.map((e) => `${e.set}: ${e.error}`))" :key="item">
            {{ item }}
          </li>
        </ul>
      </template>
    </UAlert>

    <UAlert
      v-if="fix.undone"
      color="neutral"
      variant="subtle"
      icon="i-lucide-undo-2"
      role="status"
      data-testid="undone"
      close
      @update:open="fix.dismiss()"
    >
      <template #title>
        Undone: {{ plural(fix.undone.restored, 'set') }} restored,
        {{ plural(fix.undone.trashed, 'file') }}
        moved to the Trash<template v-if="fix.undone.kept"
          >, {{ plural(fix.undone.kept, 'file') }} kept (used by a set by now)</template
        >.
      </template>
      <template v-if="fix.undone.changedSince.length || fix.undone.problems.length" #description>
        <template v-if="fix.undone.changedSince.length">
          <p>Changed since the fix, and left alone:</p>
          <ul class="list-disc ps-5">
            <li v-for="item in some(fix.undone.changedSince)" :key="item">{{ item }}</li>
          </ul>
        </template>
        <template v-if="fix.undone.problems.length">
          <p>Problems:</p>
          <ul class="list-disc ps-5">
            <li v-for="item in some(fix.undone.problems)" :key="item">{{ item }}</li>
          </ul>
        </template>
      </template>
    </UAlert>

    <UAlert
      v-if="earlier && engines.capabilities.undo"
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      role="status"
      data-testid="last-fix"
      :title="`The last fix, ${when(earlier.record?.started ?? '') || earlier.when}, rewrote ${plural(earlier.sets, 'set')} and copied ${plural(earlier.files, 'file')}.`"
      :actions="[
        {
          label: 'Undo this fix',
          icon: 'i-lucide-undo-2',
          color: 'neutral',
          variant: 'subtle',
          disabled: busy,
          loading: fix.undoing,
          onClick: () => void fix.undo(earlier?.id ?? ''),
        },
      ]"
    />

    <UAlert
      v-if="scans.stale && !scans.running"
      color="neutral"
      variant="outline"
      icon="i-lucide-refresh-cw"
      title="You changed folders or options after this scan"
      description="What you see is what the scan found. Scan again to see what the changes do."
      role="note"
      data-testid="stale"
      :actions="[
        { label: 'Scan again', color: 'neutral', variant: 'subtle', onClick: () => void scans.run() },
      ]"
    />

    <UAlert
      v-if="props.scan.samples.sets > 0 && !props.scan.samples.ableton.coreLibrary"
      color="neutral"
      variant="outline"
      icon="i-lucide-triangle-alert"
      :ui="{ icon: 'text-(--status-missing)' }"
      title="Live's own content was not among the folders"
      :description="`Samples of Live's Core Library cannot be found, and content that Live moved between versions is not recognised. ${liveAdvice}`"
      role="note"
      data-testid="no-live-content"
    />

    <UAlert
      v-if="props.scan.samples.unreadable.length"
      color="neutral"
      variant="outline"
      icon="i-lucide-triangle-alert"
      :ui="{ icon: 'text-(--status-missing)' }"
      :title="`${plural(props.scan.samples.unreadable.length, 'folder')} could not be read`"
      :description="`Permissions or privacy settings keep livesaver out, for example of ${props.scan.samples.unreadable[0]}. Samples in there were not seen.`"
      role="note"
    />
  </div>
</template>
