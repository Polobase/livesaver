# The web app

`apps/web` is one page that runs in two ways:

- **With livesaver on the same computer** (`livesaver web`, or `bun run web` in the repository):
  the computer reads the folders by their paths and checks them like `livesaver doctor`, and it
  can fix what it finds like `livesaver collect --apply`: all projects, or one. See
  [On this computer](#on-this-computer).
- **On its own in a browser** (any static host): it is given folders, checks them itself with
  the same engine (`@livesaver/ops`) on a browser host (`@livesaver/web`), and never writes. The
  sections from [How it is built](#on-its-own-how-it-is-built) to
  [What differs from the command line](#on-its-own-what-differs-from-the-command-line) are
  about this.

A browser cannot do the fixing itself. Writing needs the File System Access API, which Brave,
Safari and Firefox do not offer and whose handles hide files (see below); and a page could
neither keep a journal for an undo nor see that Live is running.

## On this computer
`livesaver web` (`packages/cli/src/web/`) serves the page and answers it:

| Request | What it does |
|---|---|
| `GET /api/info` | what the page starts with: the folders of the last check, else the settings of the command line (search folders, the projects folder of `status`), and the last fix that can still be undone |
| `GET /api/folders?path=` | the folders in a folder: the page shows them to choose one, since a browser's own folder dialog never tells a path |
| `POST /api/check` | `doctor` over the given folders; answers line by line (progress, then the result) |
| `POST /api/fix` | `collect --apply` over all projects, or over one (`only`) |
| `POST /api/undo` | `undo` of a run |

- **The same pipeline as the command line** (`collectRun`): settings, cache of complete sets,
  backups, journal, run folder and undo are those of `livesaver collect`. The result is shaped
  for the page by `checkView` (`@livesaver/ops`), which the browser engine uses too.
- **One project alone gets the plan it has among all.** A fix of one project searches the same
  folders, the other projects included. On a real library every one of 67 projects with changes
  got, checked alone, exactly the changes and copies it has in the check of all 299.
- **A fix does what was checked.** The page asks first and says what will happen; if folders or
  options were changed after the check, the fix still uses those of the check, and says so.
- **Live must not be running**, and only one run goes at a time, as on the command line.
- **Only its own page may ask.** The server listens on this computer only. Every request must
  carry a token that is written into the page when it is served, come to this address
  (`127.0.0.1` or `localhost`: a name that merely points here is refused) and, if it names an
  origin, from this page. Another site open in the browser can therefore neither read nor fix.
- **Restoring form controls is switched off** (`autocomplete="off"`): after a back navigation a
  browser hands out remembered ticks by position, so an option could show the tick of another
  box while the page itself had it off.

## On its own: how it is built
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
Recognised by name among the given folders (`apps/web/src/ableton.ts`), and named on their rows
as soon as a folder is added; what is still missing is listed under the sample folders.

- **User Library** and **Factory Packs**: a folder of that name, or the folder that holds it
  (`Music/Ableton` in the home folder).
- **Live's own content** lies inside the Live app, in `Contents/App-Resources`: the Core Library,
  and Live's table of content it moved between versions (`Database/filerefmap.db`, a SQLite file
  read by `readSqliteTable` in `@livesaver/core`). The Live app itself can be dropped on the
  page: to a drop an app is a folder, while a folder dialog does not open one (there the path of
  `App-Resources` has to be pasted). `App-Resources`, the app's `Contents` folder or the Core
  Library alone are recognised too. Of the app only the Core Library is searched.

Without Live's own content, samples of the Core Library cannot be found and moved content is not
recognised; the result says so. On a real library that made 55 of 460 complete sets look
incomplete.

## Installed libraries
Two rules only apply to files of installed libraries: a file that its vendor re-saved slightly
larger is accepted when the audio is the same, and the opt-in rule that accepts a library file
by its name and place in the library. The command line knows `/Users/Shared` (Native
Instruments) as such a place. The page cannot see that path, so each sample folder has a box,
"Contains installed libraries", ticked when the folder is called like one (`Shared`,
`Native Instruments`, `… Library`). Ableton's packs and the Core Library always count. If the
opt-in rule is switched on while no folder is marked, the page says that it will find nothing
there.

## On its own: what differs from the command line
- Read-only: nothing is collected or rewritten, and patched sets are only counted, not scanned
  strictly (`quickPlan`).
- Only the given folders are seen. The command line sees the whole disk.
- Symbolic links are not seen: a browser leaves them out of a dropped folder. The command line
  indexes links to files.
- No preferred folders for ties between identical copies, no cache of complete sets.
## How it is tested
- `packages/web/test`: `WebFs` over fake handles, uploads and listings; a `doctor` run over the
  browser host equals a run over the Node host on the fixtures.
- `apps/web/test`: the engine (locating, Ableton's folders, the Live app given as a folder, the
  remap table, the shaped result).
- `packages/cli/test`: what the page asks of this computer, on temporary copies of the fixtures:
  a check, a fix of all and of one project, undo, and that the server answers only its own page.
- `bun run test:web`: the built page in a real headless browser, in both ways. On its own:
  folders are given through the folder upload and by drops (with names a handle would hide, and
  an app as a folder); the hints, the results, the tables and a downloaded report are read from
  the page. With livesaver: a folder is chosen in the page, one project is fixed, the fix is
  undone, all are fixed, and after a reload the last fix is undone; the files on disk are
  compared each time.
- `bun run test:node`: the built `livesaver web` under Node.js serves the page it ships with.
- On a real library (876 sets, 138,662 indexed files), given the project folder and the four
  folders the command line searches, with their paths typed, the five report files of the page
  are byte-identical to those of `livesaver doctor`, apart from the time stamp. That holds for
  uploaded and for dropped folders. With the Live app dropped and no path typed, the numbers of
  the result equal the command line's, with and without `--match-library-path`. The check takes
  about 15 s in the browser (12 s on the command line).
- With livesaver on the computer, the same library gives report files byte-identical to
  `livesaver doctor` as well (dry runs only: fixing is tested on temporary copies).
