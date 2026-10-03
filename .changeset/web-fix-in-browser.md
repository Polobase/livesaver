---
'@livesaver/web': minor
'livesaver': minor
---

The web app can fix in the page itself, where a browser hands a page a folder to edit (Chrome,
Edge): an experiment that is off until its user switches it on in the Settings, after a dialog
that lists what a page cannot do. A project folder is then chosen for editing; the review shows
where the folder is taken to lie and asks that Live is closed, which a page cannot see; the fix
is the pipeline of `collect --apply`, with a backup of every set in its project. The run
(journal, originals, reports) is kept in the page's own storage, so the History lists it and
undoes it, also after a reload. A page has no Trash: what an undo takes out goes to a hidden
folder `.livesaver-trash` in the project folder. A rewritten set loses its Finder tags and
comment there, and files with names the browser hides (a `:`, a space at an end) count as
missing; the page says both.

`@livesaver/web`: `WebFsWrite` (livesaver's write port over folder handles), `fixFolders`,
`undoFolders`, `browserRuns`, `browserRun`, `browserReport`, `fixInWorker`, `undoInWorker`,
`handlesFromDrop`; `createWebHost` takes the folders that may be written to. A file behind a
handle is fetched anew when its state is asked, so a set that was saved after it was read is
noticed before it is written.

In the app, the result of a fix or an upgrade keeps its buttons in place while the library is
scanned again.
