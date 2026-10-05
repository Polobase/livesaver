---
'@livesaver/core': minor
'@livesaver/ops': minor
'@livesaver/web': minor
'livesaver': minor
---

Sets that were last saved with an older Live can be left out.

A project often keeps the first save of a song beside the newer ones; if the old save misses a
sample, the project counted as incomplete. `--min-live <version>` on the command line, and
"Leave out sets of older Live versions" in the web app, take such sets out of a check and a
fix: they are not checked, not listed and not rewritten, and the result says how many were
left out (`DoctorResult.leftOut`, `CheckView.leftOut`). `liveMajor` reads the version off a
document's `Creator`.
