/** The places of the app, in the order of the sidebar; the command palette lists them too. */
export interface Place {
  readonly label: string
  readonly icon: string
  readonly to: string
  /** Two keys pressed one after the other, e.g. `g` then `s`. */
  readonly keys: readonly [string, string]
}

export const PLACES: readonly Place[] = [
  { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/', keys: ['G', 'O'] },
  { label: 'Samples', icon: 'i-lucide-audio-waveform', to: '/samples', keys: ['G', 'S'] },
  { label: 'Plug-ins', icon: 'i-lucide-plug', to: '/plugins', keys: ['G', 'P'] },
  { label: 'History', icon: 'i-lucide-history', to: '/history', keys: ['G', 'H'] },
]

export const SETTINGS: Place = {
  label: 'Settings',
  icon: 'i-lucide-settings',
  to: '/settings',
  keys: ['G', ','],
}
