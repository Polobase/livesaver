---
'livesaver': minor
'@livesaver/ops': minor
---

`livesaver web` serves a new web app (Vite, Vue, Nuxt UI) in place of the first page. It scans
samples and plug-ins in one go, shows an overview (complete, can be fixed, samples missing),
every project, set, planned change and missing sample in tables that hold a whole library, and
missing samples grouped by where they came from, with advice. A fix is reviewed first (what
changes, with or without the uncertain matches; Live closed; enough room), applies to all
projects, a selection or one, and can be undone. It works with the keyboard alone, in light and
dark, in Chrome, Safari and Firefox. On its own in a browser it scans read-only, as before.

The plug-in screens show every plug-in the sets use against what is installed (not installed,
Rosetta only, the same plug-in in another format), what is installed and what breaks if it is
uninstalled, and what an upgrade of VST2 plug-ins to VST3 converts and what blocks the rest; an
upgrade is reviewed first and can be undone.

The default port of `livesaver web` is now 5483. A fix can take several projects (`only` of
`/api/fix`). `checkView` names for every missing sample the sets that use it and the source it
is counted under, and for every planned change its set's path.
