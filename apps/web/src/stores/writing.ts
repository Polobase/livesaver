/**
 * Fixing in the browser: whether this browser can, and whether its user switched it on. It is
 * off until then: a page that writes into project folders has limits that are to be read first.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { canWriteHere, switchWriting, writingSwitchedOn } from '../engine/storage.js'
import { useEngineStore } from './engine.js'
import { useHistoryStore } from './history.js'

export const useWritingStore = defineStore('writing', () => {
  const engines = useEngineStore()
  const history = useHistoryStore()
  /** The browser hands a page folders to edit, and gives it a storage of its own. */
  const possible = computed(() => engines.kind === 'browser' && canWriteHere())
  const on = ref(writingSwitchedOn())

  async function set(value: boolean): Promise<void> {
    switchWriting(value)
    on.value = value && canWriteHere()
    engines.refresh()
    // What an undo needs is kept in the page's storage: the browser is asked not to clear it
    // when the disk gets full. (It decides by itself, and says nothing either way.)
    if (on.value) void navigator.storage?.persist?.().catch(() => false)
    await history.refresh()
  }

  return { possible, on, set }
})
