# @livesaver/web

Browser host for livesaver: folders a page was given (folder upload, drag and drop, File System Access API) as a read-only file system, gzip, hashing and worker-based set parsing; and the scan that runs in a page.

- `WebFs`, `createWebHost`: the given folders as livesaver's Host ports (read-only).
- `foldersFromFiles`, `foldersFromDrop`, `folderFromHandle`: a folder as the browser hands it over.
- `createWorkerParser`, `serveParser`: sets parsed on web workers.
- `scanFolders`: the samples (as `livesaver doctor` reports them) and the plug-ins of every set.
- `serveEngine` (in a worker) and `scanInWorker` (in the page): the scan off the page's thread, the files staying with the page.

Part of [livesaver](https://github.com/Polobase/livesaver). Pre-alpha.
