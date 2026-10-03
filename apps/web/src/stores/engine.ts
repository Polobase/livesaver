/** The engine behind the app, and what it starts with. */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createEngine } from '../engine/create.js'
import type { Capabilities, Engine, Start } from '../engine/types.js'

const NOTHING: Capabilities = {
  paths: false,
  fix: false,
  upgrade: false,
  undo: false,
  history: false,
  reveal: false,
  installedPlugins: false,
  liveStatus: false,
  keepsScan: false,
}

export const useEngineStore = defineStore('engine', () => {
  const current = shallowRef<Engine>()
  const start = shallowRef<Start>()
  const capabilities = shallowRef<Capabilities>(NOTHING)
  /** Why the engine could not be reached ('' = it could, or was not asked yet). */
  const problem = ref('')

  /** Puts an engine in place of the page's own (tests bring theirs). */
  function use(engine: Engine): void {
    current.value = engine
    capabilities.value = engine.capabilities
  }

  /** The engine of this page: made when it is first needed. */
  function engine(): Engine {
    if (!current.value) use(createEngine())
    return current.value as Engine
  }

  async function load(): Promise<void> {
    problem.value = ''
    const own = engine()
    try {
      start.value = await own.start()
      // livesaver has said by now what its system can do.
      capabilities.value = own.capabilities
    } catch (error) {
      problem.value = (error as Error).message
    }
  }

  const kind = computed(() => current.value?.kind ?? 'browser')

  return { engine, start, problem, load, use, kind, capabilities }
})
