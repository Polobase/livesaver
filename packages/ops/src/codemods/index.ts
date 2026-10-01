import type { Codemod } from '../codemod.js'
import masteringOff from './mastering-off.js'
import setTempo from './set-tempo.js'

/** Codemods that come with livesaver, by name. */
export const BUILTIN_CODEMODS: ReadonlyMap<string, Codemod> = new Map(
  [setTempo, masteringOff].map((c) => [c.name, c]),
)
