<script setup lang="ts">
/**
 * How a scan matches: the opt-in rule for library files, what stays in its pack, and which sets
 * are left out for the Live that saved them.
 */
import { LEAVE_OUT } from '../../lib/library'
import { platform } from '../../lib/platform'
import { useLibraryStore } from '../../stores/library'

defineProps<{ disabled?: boolean }>()
const library = useLibraryStore()

/** Every set is the same as no such option: two scans of every set are then the same scan. */
function leaveOut(minLive: number): void {
  const { minLive: _before, ...rest } = library.options
  library.options = minLive > 0 ? { ...rest, minLive } : rest
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <USwitch
        :model-value="library.options.matchLibraryPath"
        :disabled="disabled"
        label="Also accept a library file with another fingerprint"
        description="When its name and its place in the library match. Vendors re-tagged samples between library versions, so the installed file can differ from the one a set remembers. Such a match is marked uncertain."
        @update:model-value="library.options = { ...library.options, matchLibraryPath: $event }"
      />
      <p
        v-if="library.options.matchLibraryPath && !library.libraryMarked"
        class="mt-2 ms-11 text-sm text-muted"
        role="note"
        data-testid="option-note"
      >
        None of your sample folders is marked "Contains installed libraries", so this only applies
        to Ableton's packs. Tick it on the folder that holds your libraries (Native Instruments
        installs them in <code class="text-xs">{{ platform.vendorFolder }}</code>).
      </p>
    </div>
    <UFormField
      label="Keep large pack files in their pack"
      description="A file of an Ableton pack or the Core Library larger than this is not copied into the project; the set points at it in the pack. 0 never copies."
    >
      <div class="flex items-center gap-2">
        <UInputNumber
          :model-value="library.options.packLimitMB"
          :min="0"
          :step="10"
          :disabled="disabled"
          class="w-32"
          aria-label="Pack files larger than this stay in their pack, in megabytes"
          @update:model-value="
            library.options = { ...library.options, packLimitMB: Math.max(0, Number($event) || 0) }
          "
        />
        <span class="text-sm text-muted">MB</span>
      </div>
    </UFormField>
    <UFormField
      label="Leave out sets of older Live versions"
      description="A set that was last saved with such a Live is not checked, not listed and not fixed. For old saves you keep as they were, beside newer ones of the same song."
    >
      <USelect
        :model-value="library.options.minLive ?? 0"
        :items="LEAVE_OUT"
        :disabled="disabled"
        class="w-64"
        aria-label="Leave out sets of older Live versions"
        data-testid="min-live"
        @update:model-value="leaveOut(Number($event))"
      />
    </UFormField>
  </div>
</template>
