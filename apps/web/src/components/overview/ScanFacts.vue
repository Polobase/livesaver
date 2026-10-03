<script setup lang="ts">
/** What was scanned, against what, and what was recognised: the small print of a scan. */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, plural, seconds } from '../../lib/format'
import { useEngineStore } from '../../stores/engine'

const props = defineProps<{ scan: Scan }>()
const engines = useEngineStore()
const own = computed(() => {
  const { userLibrary, factoryPacks, coreLibrary } = props.scan.samples.ableton
  return [
    userLibrary ? 'User Library' : '',
    factoryPacks ? 'Factory Packs' : '',
    coreLibrary ? 'Core Library' : '',
  ].filter((name) => name)
})
const took = computed(() =>
  Object.values(props.scan.seconds).reduce((sum, part) => sum + (part ?? 0), 0),
)
</script>

<template>
  <p class="text-sm text-muted" data-testid="facts">
    Scanned {{ plural(scan.samples.sets, 'set') }} against
    {{ count(scan.samples.indexedFiles) }} audio files and Max devices in {{ seconds(took) }},
    {{ engines.kind === 'computer' ? 'on this computer' : 'in this browser' }}.
    <template v-if="own.length">Recognised: {{ own.join(', ') }}.</template>
    <template v-else>No User Library, Factory Packs or Core Library among the folders.</template>
    <template v-if="scan.samples.ableton.remapEntries">
      Live's list of content it moved between versions was used ({{
        count(scan.samples.ableton.remapEntries)
      }}
      entries).
    </template>
    The scan changed nothing.
  </p>
</template>
