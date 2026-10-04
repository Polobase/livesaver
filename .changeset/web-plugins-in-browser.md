---
'@livesaver/core': minor
'@livesaver/plugins': minor
'@livesaver/web': minor
'livesaver': minor
---

The web app on its own knows what is installed once it is shown, and upgrades plug-ins itself.

A page cannot look for plug-ins, but its user can show them: the Settings take a plug-in folder
and the folder of Live's plug-in database. The scan then says which plug-ins of the sets are
installed, missing or Rosetta only, as livesaver on the computer does (`installedIn`,
`ScanRequest.installed`). With fixing in the page switched on (Chrome, Edge), **Plug-ins ›
Upgrade to VST3** plans and applies the upgrade in the page, with a backup of every set, the
run in the page's storage, and an undo (`planUpgradeFolders`, `upgradeFolders`).

Live's plug-in database is read without SQLite: `readSqliteTable` in `@livesaver/core` reads a
table from the file format (with the write-ahead log beside it, which holds what Live scanned
last while it runs), and `parsePluginDatabase` in `@livesaver/plugins` gives the rows the
command line reads in SQL.

Fixed: fixing one project, or a selection, in the page failed ("could not be cloned"): the
choice was sent to the page's worker as the app's state keeps it, which a browser refuses.
Fixing everything worked. And a plan for an upgrade that could not be made is now made again
after the next scan, instead of waiting for "Try again".
