/**
 * The check behind this page: the scan of `@livesaver/web`, of which this page shows the samples.
 */
import { type ScanEngineOptions, scanFolders } from '@livesaver/web'
import { inPageWords } from './format.js'
import type { EngineEvent, RunRequest } from './protocol.js'

export type EngineOptions = ScanEngineOptions

export async function run(
  request: RunRequest,
  emit: (event: EngineEvent) => void,
  options: EngineOptions,
): Promise<void> {
  await scanFolders(
    request,
    (event) => {
      if (event.type !== 'scanned') return emit(event)
      const { scan } = event
      emit({
        type: 'done',
        result: {
          ...inPageWords(scan.samples),
          phases: scan.seconds,
          reports: scan.reports,
          folders: scan.folders,
          usage: scan.usage,
          ableton: scan.ableton,
        },
      })
    },
    options,
  )
}
