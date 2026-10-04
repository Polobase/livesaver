---
'livesaver': minor
'@livesaver/ops': minor
'@livesaver/core': minor
'@livesaver/node': minor
'@livesaver/web': patch
---

What the first fix of a real library showed.

A rewritten set now carries the date of the fix (`FsWrite.replaceFile` no longer puts the old
modification time back): with its old date, a set looked in Finder as if nothing had been done
to it. Its backup keeps the date the set had, and an undo gives the set that date back
(`replaceFile(path, data, modified)`).

An undo finishes. A copy was kept whenever a set of its project used it, and a fix puts a file
where its set looks for it if it can: the set that an undo had just restored then "used" the
copy, the copy stayed, and the run read "undone in part" for good. A set that is again what it
was before the run no longer counts. The projects to look at come from the run's sets (a set
outside a project folder was not looked at, and its copies went to the Trash even if it had
been changed since); paths are compared as macOS compares them; a step that is found taken
back already is noted, so the run reads as undone; a copy that cannot be moved to the Trash is
reported and does not end the undo. `RunSummary.standing` says what of a run is left to take
back.

Missing samples that lie in an installed library in another version are said to be there. With
the rule for library files off, `choose` names the file the rule would take
(`Choice.libraryFile`); `checkView` counts them (`libraryFiles`: samples, references, sets,
sets that would be complete) and names the file per missing sample; a source whose samples are
in the installed library is no longer told to be installed (`hintOf`, `SourceRow.inLibrary`).
The command line's summary and report files name `--match-library-path`; `doctor --json` has
`libraryFile`. The app shows it on the overview and above the missing samples, with one button
that switches the rule on and scans again.
