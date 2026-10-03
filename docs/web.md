# The web app

`apps/web` checks Live projects for missing samples in the browser. It runs the same engine as
`livesaver doctor` (`@livesaver/ops`) on a browser host (`@livesaver/web`) and never writes.

## How it is built
- **The page** (Preact) only holds the folders and shows the result.
- **An engine worker** runs `doctor`, so the page stays responsive.
- **Parse workers** (started by the engine worker) gunzip the sets and find their references.
- `bun run build` in `apps/web` bundles the page and both workers with fixed names, because the
  page starts the workers by URL. `bun run web` serves it and rebuilds when the page is loaded
  after a source change.

## Folders in a browser
A page gets a folder in one of three ways (`packages/web/src/source.ts`):

| How | Browsers | What the page gets |
|---|---|---|
| folder upload (`<input webkitdirectory>`) | all | every file of the folder at once; nothing is uploaded anywhere |
| drag and drop (entries API) | all | the folder's entries; the page lists them and fetches a file when it is read |
| `showDirectoryPicker` (File System Access API) | Chrome, Edge (off by default in Brave) | a handle; folders are listed and files opened on demand |

`WebFs` mounts these folders at absolute paths and implements the read-only `FsRead` port.

**The page takes uploads and drops, not handles.** A handle is convenient (no "upload" question,
nothing listed up front) and the only way a page could ever write, but Chromium does not show
everything through it:
- Entries with names it considers unsafe are left out without a word: a name with a `:` (which
  Finder shows as `/`, as in a sample folder "Claps/Snares"), a name that starts or ends with a
  space (" (Freeze).wav" and the like occur in real projects), `desktop.ini` and a few more. In
  a real music folder that hid 5,220 of 108,423 entries, among them three whole sample folders,
  and the check then called samples missing that are there.
- No handle is given for a folder in `/Applications` (where Live's `App-Resources` lies), nor for
  the home, Documents or Desktop folder itself.

Uploads and drops show every file. `@livesaver/web` still reads handles (`folderFromHandle`) for
callers who accept that.

**Files are fetched lazily.** For an uploaded folder even reading a file's size costs a round
trip to the browser (about 60 µs), and sending a `File` object to a worker about 30 µs: touching
all 290,000 files of a library up front froze the page for 17 s. So the engine gets only the
paths; it asks the page for a file when it needs its size or content (about 1,700 files in a run
over 876 sets). `FsRead.kind` answers "file or directory?" from the listing alone, which is all
that the existence checks of the 104,000 references need. A dropped folder is only listed, too
(about 2 s for 100,000 files): fetching each of its files (`FileSystemFileEntry.file()`) costs
about 180 µs, most of a minute for a library.

## Where a folder lies on disk
A browser never tells a page a folder's path, but sets store absolute paths, and those are
compared with the folders' paths.

- **Project folders** are located from the sets: a reference stored relative to its project also
  names the file by an absolute path, which says where the project was when the set was saved.
  The folder is the one with its name in that path. Projects moved inside the folder since then
  do not matter; if the folder itself was renamed, its location is unknown.
- **Sample folders** that hold a project folder, or lie directly in one, are placed by it.
- Every other folder gets a stand-in path (`/<name>`), unless the user types its path. Other
  stored paths are no evidence: a path that no longer exists would move a folder to a place
  where it is not, and the missing file would then seem to exist, unchecked.

With a stand-in path, a file that a set references by an absolute path into that folder is not
"outside the project" but "missing", and is found again by name and fingerprint: the result is
the same repair, counted in another row.

## Ableton's own folders
Recognised by name among the given folders: `User Library`, `Factory Packs`, `Core Library`. If
the whole `App-Resources` folder of the Live app is given, the page also reads Live's table of
content it moved between versions (`Database/filerefmap.db`, a SQLite file read by
`readSqliteTable` in `@livesaver/core`), and only the Core Library inside it is searched.

## What differs from the command line
- Read-only: nothing is collected or rewritten, and patched sets are only counted, not scanned
  strictly (`quickPlan`).
- Only the given folders are seen. The command line sees the whole disk.
- Symbolic links are not seen: a browser leaves them out of a dropped folder. The command line
  indexes links to files.
- No preferred folders for ties between identical copies, no cache of complete sets.
## How it is tested
- `packages/web/test`: `WebFs` over fake handles, uploads and listings; a `doctor` run over the
  browser host equals a run over the Node host on the fixtures.
- `apps/web/test`: the engine (locating, Ableton's folders, the remap table, the shaped result).
- `bun run test:web`: the built page in a real headless browser. Folders are given through the
  folder upload and by drops (with names a handle would hide); the results, the tables and a
  downloaded report are read from the page.
- On a real library (876 sets, 138,662 indexed files), given the project folder and the four
  folders the command line searches, with their paths typed, the five report files of the page
  are byte-identical to those of `livesaver doctor`, apart from the time stamp. That holds for
  uploaded and for dropped folders. The check takes about 15 s in the browser (12 s on the
  command line).
