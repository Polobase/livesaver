/** The engine behind the app, and what it starts with. */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createEngine } from '../engine/create.js'
import type { Engine, Start } from '../engine/types.js'

export const useEngineStore = defineStore('engine', () => {
  const engine = shallowRef<Engine>(createEngine())
  const start = shallowRef<Start>()
  /** Why the engine could not be reached ('' = it could, or was not asked yet). */
  const problem = ref('')

  const capabilities = shallowRef(engine.value.capabilities)

  async function load(): Promise<void> {
    problem.value = ''
    try {
      start.value = await engine.value.start()
      // livesaver has said by now what its system can do.
      capabilities.value = engine.value.capabilities
    } catch (error) {
      problem.value = (error as Error).message
    }
  }

  const kind = computed(() => engine.value.kind)

  return { engine, start, problem, load, kind, capabilities }
})
