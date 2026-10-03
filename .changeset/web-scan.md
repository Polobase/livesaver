---
'livesaver': minor
'@livesaver/ops': minor
'@livesaver/core': minor
'@livesaver/web': minor
'@livesaver/plugins': patch
'@livesaver/node': patch
---

`--certain-only` (`doctor`, `collect`): only a file that the stored fingerprint confirms is taken;
an uncertain match stays missing, with the file as its candidate. A check says for every project
what a fix does with the uncertain matches and without (`certain` in `checkView`).

`plugins audit` is three times as fast: the plug-ins of a set are read from its plug-in devices
alone (`pluginUses` in `@livesaver/core`), and every parsed set carries them. `plugins upgrade`
reads the sets on worker threads.

Every run folder says what the run was asked and how it ended (`run.json`). `livesaver runs`
tells a run that was undone in part from one undone as a whole.

`livesaver web` answers more: a scan (samples and plug-ins, every set read once), the plan and
the apply of a plug-in upgrade, the history with its reports, whether Live is running, and
showing a file in Finder. The last scan is kept for a page that is opened again.

Fixed: under Bun, `--json` output larger than 64 KB was cut off in a pipe.

`@livesaver/web`: the scan that runs in a page (`scanFolders`, `serveEngine`, `scanInWorker`),
with the plug-ins of every set. `@livesaver/ops`: `pluginsView`, `uninstallView`, `upgradeView`
and `runSummary` shape the plug-in audit, an upgrade and the history for a user interface.
