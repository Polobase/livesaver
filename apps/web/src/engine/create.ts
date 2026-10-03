/**
 * The engine of this page: livesaver on this computer if it served the page (its HTML then
 * carries a token), else the browser itself.
 */
import type { EngineWorker } from '@livesaver/web'
import { BrowserEngine } from './browser.js'
import { ComputerEngine, localToken } from './computer.js'
import type { Engine } from './types.js'

export function createEngine(): Engine {
  const token = localToken(document)
  if (token) return new ComputerEngine({ token })
  return new BrowserEngine({
    spawn: () =>
      new Worker(new URL('./engine.worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as EngineWorker,
  })
}
