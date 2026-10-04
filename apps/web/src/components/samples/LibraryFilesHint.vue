<script setup lang="ts">
/**
 * Missing samples that lie in an installed library after all: its vendor re-saved the files, so
 * their fingerprints are not those the sets remember. The rule that takes such files is off
 * unless it is asked for (what it finds is not confirmed), and nobody goes looking for a switch
 * in the settings while a scan says "missing": so the scan says it here, with the switch.
 */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { plural } from '../../lib/format'
import { useScanStore } from '../../stores/scan'

const props = defineProps<{ scan: Scan }>()
const scans = useScanStore()
const offered = computed(() => props.scan.samples.libraryFiles)
</script>

<template>
  <div
    v-if="offered.samples > 0"
    class="rounded-md bg-elevated/60 p-3 text-sm"
    role="note"
    data-testid="library-files"
  >
    <p>
      <span class="font-medium text-highlighted">
        {{ plural(offered.samples, 'of these is', 'of these are') }}
        in your installed libraries,
      </span>
      at the same place and under the same name, but re-saved by
      {{ offered.samples === 1 ? 'its' : 'their' }} vendor: the fingerprint differs from the one
      your sets remember.
      <template v-if="offered.completeSets">
        With {{ offered.samples === 1 ? 'it' : 'them' }},
        {{ plural(offered.completeSets, 'more set is', 'more sets are') }}
        complete.
      </template>
    </p>
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <UButton
        size="xs"
        color="neutral"
        variant="subtle"
        icon="i-lucide-library"
        :label="offered.samples === 1 ? 'Take it too' : 'Take them too'"
        :loading="scans.running"
        :disabled="scans.running"
        data-testid="take-library-files"
        @click="scans.acceptLibraryFiles()"
      />
      <span class="text-muted">
        Scans again.
        {{
          offered.samples === 1
            ? 'It is then an uncertain match: a fix can leave it out.'
            : 'They are then uncertain matches: a fix can leave them out.'
        }}
      </span>
    </div>
  </div>
</template>
