/** What an upgrade of chosen plug-ins would do, summed from the plan. */
import type { UpgradePluginRow, UpgradeView } from '@livesaver/ops'
import { plural } from './format.js'

export interface UpgradeSum {
  /** Sets that are rewritten: a set counts once, however many of its plug-ins convert. */
  readonly sets: number
  readonly instances: number
  /** Instances whose own choice of parameters is put back to the plug-in's default. */
  readonly selectionsReset: number
  readonly projects: number
}

export function upgradeSum(plan: UpgradeView, plugins: readonly string[]): UpgradeSum {
  const chosen = new Set(plugins)
  const rows = plan.rows.filter((row) => row.converted && chosen.has(row.plugin))
  return {
    sets: new Set(rows.map((row) => `${row.root}\u0000${row.set}`)).size,
    instances: rows.reduce((n, row) => n + row.instances, 0),
    selectionsReset: rows.reduce((n, row) => n + row.selectionsReset, 0),
    projects: new Set(rows.map((row) => row.root)).size,
  }
}

/** What stands in the way of a plug-in's instances, in a sentence each. */
export function blockerLines(plugin: UpgradePluginRow): string[] {
  return plugin.blockers.map(
    (blocker) => `${plural(blocker.instances, 'instance')}: ${blocker.reason}`,
  )
}
