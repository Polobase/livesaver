/** The engine behind the app, and what it starts with. */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createEngine } from '../engine/create.js'
import { type Capabilities, type Engine, type Start, Unreachable } from '../engine/types.js'

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
  ownSettings: false,
}

/**
 * The engine with every answer watched: whichever screen asks, an engine that is gone is noticed
 * in one place, and said on every page.
 */
function watched(engine: Engine, lost: (message: string) => void): Engine {
  return new Proxy(engine, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const answer = value.apply(target, args) as unknown
        if (answer instanceof Promise)
          answer.catch((error: unknown) => {
            if (error instanceof Unreachable) lost(error.message)
          })
        return answer
      }
    },
  })
}

export const useEngineStore = defineStore('engine', () => {
  const current = shallowRef<Engine>()
  const start = shallowRef<Start>()
  const capabilities = shallowRef<Capabilities>(NOTHING)
  /** Why the engine cannot be reached ('' = it can, or was not asked yet). */
  const problem = ref('')
  /** The engine was asked what it starts with, and has not answered yet. */
  const loading = ref(false)

  /** Puts an engine in place of the page's own (tests bring theirs). */
  function use(engine: Engine): void {
    current.value = watched(engine, (message) => {
      problem.value = message
    })
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
    loading.value = true
    try {
      start.value = await own.start()
      // livesaver has said by now what its system can do.
      capabilities.value = own.capabilities
    } catch (error) {
      // Said in the engine's own words if it is gone; else it answered, and something is wrong.
      if (!problem.value) problem.value = (error as Error).message
    } finally {
      loading.value = false
    }
  }

  /** What the engine can do may follow a setting (fixing in the browser): it is asked again. */
  function refresh(): void {
    if (current.value) capabilities.value = current.value.capabilities
  }

  /** Back to the engine's own settings: what it starts with then. Rejects if it cannot. */
  async function reset(): Promise<Start> {
    start.value = await engine().reset()
    return start.value
  }

  const kind = computed(() => current.value?.kind ?? 'browser')
  /** The page came from elsewhere and was connected to livesaver on this computer. */
  const paired = computed(() => current.value?.paired ?? false)

  return {
    engine,
    start,
    problem,
    loading,
    load,
    refresh,
    reset,
    use,
    kind,
    paired,
    capabilities,
  }
})
