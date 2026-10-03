---
'livesaver': minor
'@livesaver/ops': minor
---

`livesaver web`: the web app on this computer, where it can also fix. It checks like `doctor`
and fixes like `collect --apply`, all projects at once or one project at a time, asks before it
writes, and can undo a fix. Folders are chosen by path in the page; the settings are those of
the command line.

`checkView` (`@livesaver/ops`) shapes a check's result for a user interface: totals, and a row
per project, set, missing sample and planned change.
