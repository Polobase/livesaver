/** Hand a report to the browser as a file to save. */

export const REPORT_TITLES: Readonly<Record<string, string>> = {
  'overview.md': 'Overview',
  'missing_samples.csv': 'Missing samples',
  'missing_sources.csv': 'Sources of missing samples',
  'projects.csv': 'Sets',
  'changes.csv': 'Planned changes',
  'vst3_upgrade.csv': 'Plug-in upgrade',
}

export function download(name: string, content: string): void {
  const type = name.endsWith('.csv') ? 'text/csv' : 'text/markdown'
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Not at once: some browsers start the download only after this function has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
