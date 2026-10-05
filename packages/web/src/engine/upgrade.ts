/**
 * An upgrade of VST2 plug-ins to VST3 in the browser: `livesaver plugins upgrade` as a plan,
 * and, through the handles of project folders that were given for editing, applied, with the
 * run in the page's own storage (see `fix.ts`). Which VST3 plug-ins Live has, the page reads
 * from Live's plug-in database, which its user has to hand it.
 */
import { posix } from '@livesaver/core'
import {
  applyWriter,
  journalPath,
  type RunContext,
  type SetUpgrade,
  UPGRADE_REPORT,
  upgradePlugins,
  upgradeReport,
  upgradeView,
} from '@livesaver/ops'
import type { Catalog } from '@livesaver/plugins'
import type { WebHost } from '../host.js'
import { alone, prepareToWrite, targetsOf, type WriteEngineOptions } from './fix.js'
import { installedIn } from './installed.js'
import type { UpgradeEvent, UpgradeRequest } from './protocol.js'
import { endRun, newRun } from './runs.js'
import { onWindowsFor, prepare, type ScanEngineOptions } from './scan.js'

/** The VST3 plug-ins Live knows, from its database among the folders of the request. */
async function catalogOf(request: UpgradeRequest, options: ScanEngineOptions): Promise<Catalog> {
  const installed = await installedIn(request.installed ?? [], onWindowsFor(request, options))
  if (!installed.database)
    throw new Error(
      'To know which VST3 plug-ins Live has, this page needs Live’s plug-in database: add the folder “Live Database” to the plug-in folders, and scan again.',
    )
  if (installed.catalog.size === 0) throw new Error("No VST3 plug-ins in Live's plug-in database.")
  return installed.catalog
}

const progress =
  (emit: (event: UpgradeEvent) => void) => (set: SetUpgrade, done: number, total: number) =>
    emit({ type: 'progress', done, total, name: posix.basename(set.setPath) })

/** What an upgrade would do: nothing is written. */
export async function planUpgradeFolders(
  request: UpgradeRequest,
  emit: (event: UpgradeEvent) => void,
  options: ScanEngineOptions,
): Promise<void> {
  let close = async () => {}
  try {
    emit({ type: 'phase', phase: 'plugins' })
    const catalog = await catalogOf(request, options)
    const prepared = await prepare(request, options)
    close = () => prepared.parser.close()
    const planned = await upgradePlugins(prepared.host, {
      targets: await targetsOf(prepared, request.only),
      catalog,
      only: request.names ?? [],
      probe: prepared.probe,
      parser: prepared.parser,
      onSet: progress(emit),
    })
    emit({ type: 'planned', upgrade: upgradeView(planned) })
  } catch (error) {
    emit({ type: 'failed', message: (error as Error).message || String(error) })
  } finally {
    await close().catch(() => {})
  }
}

/** The upgrade itself, with a backup of every set and the run kept for an undo. */
export async function upgradeFolders(
  request: UpgradeRequest,
  emit: (event: UpgradeEvent) => void,
  options: WriteEngineOptions,
): Promise<void> {
  let run: RunContext | undefined
  let host: WebHost | undefined
  let close = async () => {}
  try {
    await alone(options, async () => {
      emit({ type: 'phase', phase: 'plugins' })
      const catalog = await catalogOf(request, options)
      const prepared = await prepareToWrite(request, options)
      host = prepared.host
      close = () => prepared.parser.close()
      const targets = await targetsOf(prepared, request.only)
      const names = request.names ?? []
      run = await newRun(host, 'vst3', { targets, options: { plugin: names, exclude: [] } })
      emit({ type: 'phase', phase: 'upgrading' })
      const done = await upgradePlugins(host, {
        targets,
        catalog,
        only: names,
        probe: prepared.probe,
        parser: prepared.parser,
        writer: applyWriter(host, run, prepared.probe),
        onSet: progress(emit),
      })
      await host.write?.writeFile(
        posix.join(run.dir, UPGRADE_REPORT),
        upgradeReport(done.results, done.base),
      )
      const written = done.results.filter((set) => set.written).length
      const errors = done.results
        .filter((set) => set.error)
        .map((set) => ({ set: set.setPath, error: set.error }))
      await endRun(host, run, {
        sets: done.results.length,
        changingSets: done.results.filter((set) => set.changed && !set.error).length,
        written,
        errors: errors.length,
      })
      emit({
        type: 'upgraded',
        upgraded: { run: run.id, sets: written, upgrade: upgradeView(done), errors },
      })
    })
  } catch (error) {
    const message = (error as Error).message || String(error)
    let wrote = false
    if (run && host) {
      await endRun(host, run, {}, message).catch(() => {})
      wrote = (await host.fs.kind(journalPath(run)).catch(() => undefined)) === 'file'
    }
    emit({ type: 'failed', message, ...(run && wrote ? { run: run.id } : {}) })
  } finally {
    await close().catch(() => {})
  }
}
