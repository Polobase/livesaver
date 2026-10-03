/**
 * The engine of this page: livesaver on this computer if it served the page (its HTML then
 * carries a token) or if the page was connected to it (`livesaver web --pair`), else the
 * browser itself.
 */
import type { EngineWorker } from '@livesaver/web'
import { BrowserEngine } from './browser.js'
import { ComputerEngine, localToken } from './computer.js'
import { clearPairing, type Pairing, readPairing, takePairing } from './pairing.js'
import { browserState, canWriteHere, writingSwitchedOn } from './storage.js'
import type { Engine } from './types.js'

/** The tab's own store; a browser may keep a page from it (private modes do). */
function store(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/** Before the app starts: a pairing in the address is taken, and the address cleared. */
export function takePairingFromAddress(): Pairing | undefined {
  const tab = store()
  return tab ? takePairing(window.location, window.history, tab) : undefined
}

/** Lets go of the livesaver the page was connected to: it is a page on its own again. */
export function disconnect(): void {
  const tab = store()
  if (tab) clearPairing(tab)
  window.location.reload()
}

export function createEngine(): Engine {
  const token = localToken(document)
  if (token) return new ComputerEngine({ token })
  const tab = store()
  const pairing = tab ? readPairing(tab) : undefined
  if (pairing) return new ComputerEngine({ token: pairing.token, base: pairing.at, paired: true })
  return new BrowserEngine({
    spawn: () =>
      new Worker(new URL('./engine.worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as EngineWorker,
    ...(canWriteHere() ? { state: browserState } : {}),
    writing: writingSwitchedOn,
  })
}
