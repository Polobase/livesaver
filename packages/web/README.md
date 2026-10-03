# @livesaver/web

Browser host for livesaver: folders a page was given (folder upload, drag and drop, File System Access API) as a file system, gzip, hashing and worker-based set parsing; the scan that runs in a page; and a fix through folder handles, where a browser hands a page a folder to edit.

- `WebFs`, `createWebHost`: the given folders as livesaver's Host ports. Read-only, unless folders are given for editing.
- `foldersFromFiles`, `foldersFromDrop`, `folderFromHandle`, `handlesFromDrop`: a folder as the browser hands it over.
- `createWorkerParser`, `serveParser`: sets parsed on web workers.
- `scanFolders`: the samples (as `livesaver doctor` reports them) and the plug-ins of every set.
- `WebFsWrite`: livesaver's write port over the handles of folders the user chose for editing (Chrome, Edge).
- `fixFolders`, `undoFolders`: `livesaver collect --apply` and `livesaver undo` through those handles, with the run (journal, originals, reports) in a folder of the page's own storage; `browserRuns`, `browserRun`, `browserReport` read it.
- `serveEngine` (in a worker) and `scanInWorker`, `fixInWorker`, `undoInWorker` (in the page): a run off the page's thread, the files staying with the page.

What a page cannot do that livesaver on the computer can is listed in [docs/web.md](../../docs/web.md#fixing-in-a-browser).

Part of [livesaver](https://github.com/Polobase/livesaver). Pre-alpha.
