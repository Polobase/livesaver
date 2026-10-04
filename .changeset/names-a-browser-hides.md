---
'@livesaver/core': minor
'@livesaver/ops': minor
'@livesaver/web': minor
'livesaver': minor
---

A fix in the page no longer fails over file names a browser hides.

In a folder a page may edit, a browser shows no file or folder with certain names (a "/" as
Finder shows it, a space at the start or end) and makes none. A sample of such a name that lay
where its set expects it counted as missing, was found elsewhere, and was to be copied to a
name the browser refuses: every set of such a fix failed.

- A host says where it shows nothing and where it can make nothing (`FsRead.hides`,
  `FsRead.refuses`; a host that sees and makes everything leaves them out). A reference whose
  file may lie at a hidden place is left alone; a file that was found is copied to another
  place in the project, or left with the reason; a set the host cannot rewrite is checked and
  left. `Choice.blind` and `MissingRow.blind` say which (`unseen`, `unmade`, `locked`), and
  such samples are counted under a source of their own, with what to do. No set is planned to
  change for them.
- A project folder that is dropped to be edited is read in full: `editableFromDrop` gives the
  handle of the drop with the files the handle hides (`hidden` on a handle source). The same
  folder given once more among the sample folders, or a folder around it, shows them too.
- A folder that contains a project folder is placed by it also when the project folder's
  handle hides entries.
- A copy that could not be made is not counted: a run that failed for its sets no longer says
  it copied their files.

The app says what the page could not see or make, per sample and as a notice, and how to show
it every name.
