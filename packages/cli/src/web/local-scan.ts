/**
 * A scan for the web app: the samples (like `livesaver doctor`) and the plug-ins (like `livesaver
 * plugins audit`), with every set read once. What an upgrade to VST3 would do (like `livesaver
 * plugins upgrade`) is planned when it is asked for: it reads the sets with VST2 plug-ins again,
 * which a scan that is repeated after every fix should not wait for. And the upgrade itself,
 * like `livesaver plugins upgrade --apply`.
 */
import { basename } from 'node:path'
import { auditSets, pluginsView, type SetUpgrade, upgradeView } from '@livesaver/ops'
import { derivedTarget, KNOWN } from '@livesaver/plugins'
import { collectRun } from '../commands/doctor.js'
import { loadPluginSources, upgradablePlugins, upgradeRun } from '../commands/plugins.js'
import { acquireLock } from '../state.js'
import {
  LIVE_RUNNING,
  liveRuns,
  message,
  prepare,
  progress,
  remember,
  sampleResult,
  targetsOf,
  type WebSettings,
} from './local.js'
import type { WebEvent, WebPhase, WebRequest, WebUpgradeRequest } from './protocol.js'

const sources = (settings: WebSettings) => settings.plugins?.() ?? loadPluginSources()

function upgradeProgress(emit: (event: WebEvent) => void) {
  return (set: SetUpgrade, done: number, total: number) =>
    emit({ type: 'progress', done, total, name: basename(set.setPath) })
}

/** What a scan learned beyond what it tells the page. */
export interface ScanNotes {
  /** The ids of the VST2 plug-ins of every set that has some: only they can be upgraded. */
  readonly vst2: ReadonlyMap<string, readonly number[]>
}

export async function webScan(
  request: WebRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
): Promise<ScanNotes | undefined> {
  const seconds: Partial<Record<WebPhase, number>> = {}
  let phase: WebPhase = 'indexing'
  let since = performance.now()
  const close = () => {
    seconds[phase] = (seconds[phase] ?? 0) + (performance.now() - since) / 1000
    since = performance.now()
  }
  // The phases of the check are announced by its own events; their time is taken here.
  const timed = (event: WebEvent) => {
    if (event.type === 'phase') {
      close()
      phase = event.phase
    }
    emit(event)
  }
  try {
    const { targets, flags, vendorLibraries } = prepare(request, settings)
    timed({ type: 'phase', phase: 'indexing' })
    // Asked now, needed later: the first time, macOS takes a while to list its Audio Units.
    const installed = sources(settings)
    installed.catch(() => {})
    // Every set is read, complete or not: its plug-ins are read along with its samples.
    const checked = await collectRun(
      'doctor',
      targets,
      { ...flags, full: true },
      { vendorLibraries, reports: true, onEvent: progress(timed, 'checking') },
    )
    timed({ type: 'phase', phase: 'plugins' })
    const { inventory, catalog } = await installed
    const sets = checked.result.results
    const audit = auditSets(
      sets.map(({ setPath, projectRoot, plugins }) => ({
        setPath,
        projectRoot,
        ...(plugins ? { plugins } : {}),
      })),
      checked.result.base,
      { inventory, catalog },
    )
    timed({ type: 'phase', phase: 'reporting' })
    await remember(request)
    close()
    emit({
      type: 'scanned',
      at: new Date().toISOString(),
      scan: {
        samples: sampleResult(checked),
        plugins: pluginsView(audit, inventory),
        seconds,
      },
    })
    const vst2 = new Map<string, number[]>()
    for (const set of sets) {
      const ids = (set.plugins ?? [])
        .filter((use) => use.ref.format === 'VST2')
        .map((use) => Number(use.ref.ident))
      if (ids.length) vst2.set(set.setPath, ids)
    }
    return { vst2 }
  } catch (error) {
    emit({ type: 'failed', message: message(error) })
    return undefined
  }
}

/** The plug-in names of a request, checked: only what an upgrade can convert may be asked. */
function wantedPlugins(request: WebUpgradeRequest): string[] {
  const names = upgradablePlugins()
  const wanted = (request.plugins ?? []).map(String)
  const unknown = wanted.filter(
    (plugin) => !names.some((name) => name.toLowerCase() === plugin.toLowerCase()),
  )
  if (unknown.length) throw new Error(`Not a plug-in that can be upgraded: ${unknown.join(', ')}`)
  return wanted
}

/**
 * What an upgrade would do, like `livesaver plugins upgrade` without `--apply`. `notes` of a
 * scan of the same folders spare reading the sets that have no VST2 plug-in.
 */
export async function webUpgradePlan(
  request: WebUpgradeRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
  notes?: ScanNotes,
): Promise<void> {
  try {
    const targets = targetsOf(request)
    const wanted = wantedPlugins(request)
    emit({ type: 'phase', phase: 'plugins' })
    const { catalog } = await sources(settings)
    // A set is read only if it has a plug-in an upgrade says something about: one it can
    // convert, or one whose VST3 is installed.
    const told = (path: string) =>
      (notes?.vst2.get(path) ?? []).some((id) => KNOWN.has(id) || derivedTarget(id, catalog))
    const planned = await upgradeRun(
      targets,
      { plugin: wanted },
      {
        catalog,
        record: false,
        onSet: upgradeProgress(emit),
        ...(notes ? { skip: (path: string) => !told(path) } : {}),
      },
    )
    emit({ type: 'planned', upgrade: upgradeView(planned) })
  } catch (error) {
    emit({ type: 'failed', message: message(error) })
  }
}

/** An upgrade of VST2 plug-ins to VST3, like `livesaver plugins upgrade --apply`. */
export async function webUpgrade(
  request: WebUpgradeRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
): Promise<void> {
  let release = () => {}
  let started = ''
  try {
    const targets = targetsOf(request)
    const wanted = wantedPlugins(request)
    if (liveRuns(settings)) throw new Error(LIVE_RUNNING)
    const { catalog } = await sources(settings)
    release = acquireLock()
    emit({ type: 'phase', phase: 'upgrading' })
    const done = await upgradeRun(
      targets,
      { apply: true, plugin: wanted },
      {
        catalog,
        onSet: upgradeProgress(emit),
        onRun: (run) => {
          started = run.id
        },
      },
    )
    emit({
      type: 'upgraded',
      upgraded: {
        run: done.run?.id ?? '',
        sets: done.results.filter((set) => set.written).length,
        upgrade: upgradeView(done),
        errors: done.results
          .filter((set) => set.error)
          .map((set) => ({ set: set.setPath, error: set.error })),
      },
    })
  } catch (error) {
    emit({ type: 'failed', message: message(error), ...(started ? { run: started } : {}) })
  } finally {
    release()
  }
}
