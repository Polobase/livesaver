---
'@livesaver/core': minor
'@livesaver/plugins': minor
'@livesaver/ops': minor
'@livesaver/node': minor
'@livesaver/web': minor
'livesaver': minor
---

Windows, built and only tested on macOS so far.

livesaver is made on a Mac. It now also handles a computer whose paths have drives: built from
what Ableton documents of Live on Windows and from sets saved there, and not yet tried with Live
on a Windows computer.

- **Paths.** Every path is handled with `/`, and a drive is a root of its own (`C:/Users/me`):
  `posix.drive`, `posix.slashed`, and `normpath`, `dirname`, `relpath`, `commonpath` and `join`
  know drives. `nodePath` of `@livesaver/node` is `node:path` that hands paths on in that form.
- **Sets.** A stored path of Windows is tried as a file where the project lies on a drive (it
  was passed over everywhere before), a stored path of a Mac only where it does not. Written on
  Windows, a reference gets its `Path` with drive and forward slashes (as Live writes a path
  with a drive into today's format), and the old format's `PathHint` without the drive (as in
  every set that Live 9 and 10 saved on Windows).
- **The command line.** Live in `ProgramData\Ableton`, its settings and its plug-in database
  in `AppData`, `Documents\Ableton`, `C:\Users\Public\Documents`; its own files in
  `AppData\Local\livesaver`. Nothing is written while a program called like Live runs
  (`liveInTaskList`). An undo moves files to a trash folder of livesaver's own: asked to
  recycle without a question, Windows deletes for good what the Recycle Bin cannot take. A
  file is never given a name Windows cannot make (`WindowsFs`, `refusedByWindows`).
  `livesaver web` opens the browser and shows files in File Explorer.
- **The web app.** A page on Windows says where the folders are there, shows the steps to add
  Live's content from `C:\ProgramData\Ableton`, places folders by the paths with a drive that
  sets store (`ScanRequest.windows`, `onWindows`), and reads what is installed from Live's
  plug-in database alone (`installedIn(folders, true)`; `InventorySources.oneProcessor` and
  `unseenFiles`): no plug-in is "Rosetta only" there. It says that Windows is only tested on
  macOS.
- **The site.** The landing page no longer says that a page in a browser only reads: it fixes
  in Chrome and Edge, and knows what is installed once it is shown.
