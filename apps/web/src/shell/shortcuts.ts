/** The keys of the app in one place: the shell listens for them, and the overview lists them. */
import { ref } from 'vue'
import { PLACES, SETTINGS } from './navigation'

export interface Shortcut {
  /** As shown; `meta` is ⌘ on a Mac and Ctrl elsewhere. */
  readonly keys: readonly string[]
  readonly does: string
  /** The keys are pressed one after the other (`G` then `S`), not together. */
  readonly sequence?: boolean
}

export interface ShortcutGroup {
  readonly title: string
  readonly shortcuts: readonly Shortcut[]
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['meta', 'K'], does: 'Search, or jump to a place or an action' },
      { keys: ['?'], does: 'Show these shortcuts' },
      ...[...PLACES, SETTINGS].map((place) => ({
        keys: place.keys,
        does: `Go to ${place.label}`,
        sequence: true,
      })),
    ],
  },
  {
    title: 'In a table',
    shortcuts: [
      { keys: ['/'], does: 'Search the table' },
      { keys: ['↓'], does: 'Next row' },
      { keys: ['↑'], does: 'Row before' },
      { keys: ['Enter'], does: 'Open the row' },
    ],
  },
  {
    title: 'In a panel or a dialog',
    shortcuts: [{ keys: ['Esc'], does: 'Close it' }],
  },
]

/** Whether the overview of the shortcuts is open: `?` opens it, and so do the palette and Settings. */
export const shortcutsOpen = ref(false)
