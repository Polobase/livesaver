---
'@livesaver/web': minor
'@livesaver/core': minor
'@livesaver/ops': minor
---

A browser host and a web app. `@livesaver/web` turns folders a page was given (folder upload,
drag and drop, File System Access API) into the read-only file system livesaver works on, with
gzip, hashing and worker-based set parsing; `apps/web` checks Live projects for missing samples
in the browser with the same engine as `livesaver doctor`.

For hosts where reading is slow or indirect: `FsRead.kind` (file or directory without a full
`stat`), `HashPort.sha1Of` (a native one-shot hash), `readSqliteTable` and `parseRemapTable`
(Live's remap table read without SQLite), a pure SHA-1 that is 4–5 times faster, reads started
for all references of a set at once, samples up to 64 MB read in one go when hashed, and
`quickPlan` (dry runs may skip the strict scan of patched sets).
