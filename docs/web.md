# The web app

`apps/web` is one app (Vite, Vue, Nuxt UI) that runs in two situations:

- **With livesaver on the same computer** (`livesaver web`, or `bun run web` in the repository):
  the computer reads the folders by their paths and scans them like `livesaver doctor` and
  `livesaver plugins audit`, and it can fix what it finds like `livesaver collect --apply`: all
  projects, a selection, or one, after a review, with an undo. See
  [On this computer](#on-this-computer).
- **On its own in a browser** (any static host): it is handed folders, scans them itself with
  the same code (`@livesaver/ops`) on a browser host (`@livesaver/web`), and never writes. The
  sections from [How it is built](#how-it-is-built) to
  [What differs from the command line](#on-its-own-what-differs-from-the-command-line) are
  about this.

The same files serve both: relative URLs and hash routes, so they run at any path. What the app
cannot do where it runs is shown and explained, not hidden: on its own it says that fixing needs
livesaver, and how to get it.

A browser cannot do the fixing itself today. Writing needs the File System Access API, which
Brave, Safari and Firefox do not offer and whose handles hide files (see below); and a page
could neither keep a journal for an undo nor see that Live is running.

## The screens
| Place | What it shows | What can be done |
|---|---|---|
| **Overview**, before a scan | what livesaver does in three steps, the project folders and sample folders, the options | add folders, scan |
| **Overview**, after a scan | how many sets are complete, can be fixed, or have samples that stay missing (one bar); what a fix would do; what is missing, by source, with what to do about the largest; every reference by state; where found samples lie; the last changes | review and fix, download the reports, undo the last fix |
| **Samples › Projects** | every project: state, sets, what a fix changes, what stays missing, what is copied | fix one, a selection, or all; a project opens from the side with its sets, its changes (old place → new place) and its gaps; show it in Finder |
| **Samples › Missing** | missing samples grouped by where they came from, each group with advice | add the folder that has them, copy the list, open a sample |
| **Samples › Changes** | every planned change: how the file was found, and whether the fingerprint confirms it | search, filter (uncertain only), open a change |
| **Samples › Sets** | every set with what its samples are | search, filter, open a set |
| **Plug-ins › In your sets** | every plug-in the sets use: format, state (not installed, Rosetta only, installed), how often and where | search, filter; a plug-in opens from the side with what to do, the sets that use it, where it is installed, and the same plug-in in other formats |
| **Plug-ins › Installed** | what is installed: format, native or Rosetta only, version, known to Live, used by how many sets | filter (Rosetta only, used by no set, not scanned by Live); what breaks if a plug-in is uninstalled |
| **Plug-ins › Upgrade to VST3** | per plug-in what converts and what stands in the way (in a rack, automation, an old file format, no VST3 installed); every plug-in in every set | upgrade all or the ticked plug-ins after a review; undo |
| **History** | every run that changed something, by day: what it did, where, and what became of it; on request also the runs that only planned or reported | a run opens from the side with what it was asked, its numbers, its report files and every step; undo a run, after a question that says what the undo does |
| **Settings** | the folders and options of a scan, the appearance, the keyboard shortcuts, what livesaver found on this computer (Live, its libraries, the settings file, where runs and originals are kept) | change them; reset them to the command line's settings; show a folder in Finder; the app says when a scan is older than they are |

- **Nothing is written without a review.** A fix goes through three steps: what will happen
  (sets, references, copies, per project; with a switch that leaves the uncertain matches out),
  whether everything is ready (Live closed, enough free space, where the backups go), then the
  fix and what it did, with its undo.
- **A fix does what was scanned.** If folders or options were changed after the scan, the app
  says so, and a fix still uses those of the scan.
- **An undo is always within reach.** In the result of a fix, in the notice of the last fix on
  the Overview (also after a reload), in a toast when a fix was made from another page, and for
  every run in the History. The fix just made is undone with one click; a run from the History
  may be weeks old, so that undo says first what it will do.
- **Everything works with the keyboard.** `?` lists the keys: `G` then a letter goes to a place,
  `⌘K` opens the palette, `/` searches the table, the arrow keys walk its rows, Enter opens one.
- **What fails is said where one is.** A scan that failed and a livesaver that no longer answers
  are said on every page, with what to do; an error nobody expected is shown, not swallowed.
  Every page is part of the first load, so the app goes on working, and saying so, when what
  served it is gone.
- **Motion is short and optional.** A page fades in, a bar fills from its start; with the
  system's setting for reduced motion there is none.
- **The tables hold a library.** Only the rows in view are in the page: 9,305 planned changes of
  a real library scroll without a slow frame, and a search over them takes 27 ms.
- **States are never told by colour alone.** Fine, can be fixed, missing: each has an icon of its
  own shape and a label in the text colour; the three colours are checked for colour-vision
  deficiencies against the light and the dark surfaces.

## On this computer
`livesaver web` (`packages/cli/src/web/`) serves the page and answers it:

| Request | What it does |
|---|---|
| `GET /api/info` | what the page starts with: the folders of the last scan, else the settings of the command line (search folders, the projects folder of `status`); and what was found on this computer (Live's folders, the settings file, livesaver's own folder) |
| `POST /api/reset` | forgets the folders and options of the last scan: the page starts with the command line's settings again (refused while something runs) |
| `GET /api/folders?path=` | the folders in a folder: the page shows them to choose one, since a browser's own folder dialog never tells a path |
| `POST /api/check` | `doctor` over the given folders; answers line by line (progress, then the result) |
| `POST /api/scan` | the samples and the plug-ins of every set (see [A scan](#a-scan)); line by line |
| `GET /api/scan` | the last scan, with what was scanned: a page that is opened again shows it without scanning |
| `POST /api/upgrade/plan` | `plugins upgrade` as a dry run: what converts to VST3, and what blocks the rest |
| `POST /api/fix` | `collect --apply` over all projects, or over one (`only`); `certainOnly` leaves uncertain matches out |
| `POST /api/upgrade` | `plugins upgrade --apply`, of all plug-ins or of chosen ones, in all projects or in one |
| `POST /api/undo` | `undo` of a run; an undo that is refused (Live runs, there is no such run) is an answer that says why, like a fix that fails |
| `GET /api/status` | whether Live is running, what runs right now and how far it is, and (`?path=`) the free space where a folder lies |
| `GET /api/runs`, `/api/runs/<run>`, `/api/runs/<run>/reports/<file>` | the history: every run with what it did (as `livesaver runs`), its steps, its report files |
| `POST /api/reveal` | shows a file in Finder |

- **The same pipeline as the command line** (`collectRun`): settings, cache of complete sets,
  backups, journal, run folder and undo are those of `livesaver collect`. The result is shaped
  for the page by `checkView` (`@livesaver/ops`), which the browser engine uses too.
- **One project alone gets the plan it has among all.** A fix of one project searches the same
  folders, the other projects included. On a real library every one of 67 projects with changes
  got, checked alone, exactly the changes and copies it has in the check of all 299.
- **A fix does what was checked.** The page asks first and says what will happen; if folders or
  options were changed after the check, the fix still uses those of the check, and says so.
- **Live must not be running**, and only one run goes at a time, as on the command line.
- **A run goes on when the page is closed.** A fix must not stop half-way, so the server finishes
  it; the page asks `status` to see that something runs. A scan is kept until something is
  written (a fix, an upgrade, an undo): what it found is no longer true then.
- **A fix can leave the uncertain matches out.** The check's result says for every project what
  a fix does with them and without (`certain` in `checkView`), from one check, so a page can
  show both before it asks. On a real library the numbers without them (140 sets, 9,291
  references, 1,968 copies) equal those of a check with `--certain-only`, for each of 299 projects.
- **Only its own page may ask.** The server listens on this computer only. Every request must
  carry a token that is written into the page when it is served, come to this address
  (`127.0.0.1` or `localhost`: a name that merely points here is refused) and, if it names an
  origin, from this page. Another site open in the browser can therefore neither read nor fix.
- **Restoring form controls is switched off** (`autocomplete="off"`): after a back navigation a
  browser hands out remembered ticks by position, so an option could show the tick of another
  box while the page itself had it off.

## The app elsewhere, connected to this computer
The app on livesaver's site is the same files as the app livesaver serves. On its own it only
reads; `livesaver web --pair` connects it to the livesaver of the same computer:

- **The pairing link** opens the app with where livesaver is and its token behind the `#` of
  the address (`#/connect?at=http://127.0.0.1:5483&token=…`), a part a browser does not send to
  the site. The app takes it before it reads the address as a place to go to, keeps it for the
  tab (so a reload stays connected), and clears the address. It accepts only an address of this
  computer: a link cannot make the page talk to another machine.
- **The server lets exactly that site in.** Started with `--pair`, it answers what a browser
  asks before a page of another origin may send the token (the origin, the header, and that a
  public site reaches this computer), and lets the paired site read its answers. Every other
  origin is refused as before, and the token and the address checks stay as they are. Without
  `--pair`, the site is a stranger like any other.
- **A browser has the last word.** Chrome, Edge, Firefox and Brave ask the user whether the page
  may reach this computer; Safari does not allow it. While a browser asks, the page says that
  it is connecting; refused, it says that livesaver does not answer and that the app livesaver
  serves itself works everywhere; either way it can go on on its own. Checked with the app as
  deployed on the site: Chromium connects and scans once that permission is given, and WebKit
  refuses.
- **Both sides name their protocol** (`api` in `/api/info`, `WEB_API`). A page that livesaver
  serves always fits; a connected page may be older or newer than its livesaver, and says so
  instead of misreading its answers.

## A scan
A scan is what the screens are built on: the samples (as `doctor` reports them) and the
plug-ins of every set (as `plugins audit` reports them).

- **Every set is read once.** The parse workers return a set's plug-ins with its references
  (`pluginUses` in `@livesaver/core` finds the plug-in devices by byte search and scans only
  those, instead of the whole document), so the plug-ins cost no second pass. On a real library
  (876 sets) a scan takes 12.5 s; the check alone takes 12 s, and the audit used to take
  another 11 s.
- **The upgrade plan is made when it is asked for.** It reads the sets with a VST2 plug-in an
  upgrade says something about again (about 380 of 876), about 5 s, which a scan repeated after
  every fix should not wait for. It is kept with the scan.
- **No cache of complete sets**: a set that is skipped tells nothing about its plug-ins. Its
  report files equal those of `doctor --full`.

## One contract, two engines
The app talks to an `Engine` (`apps/web/src/engine/types.ts`): start, reset, scan, plan an
upgrade, fix, upgrade, undo, the history, status, reveal, list folders. Two engines implement
it:

| | `ComputerEngine` | `BrowserEngine` |
|---|---|---|
| what it is | livesaver on this computer, over the requests above | the browser: a worker over the folders the page was handed (`scanInWorker`, `serveEngine` in `@livesaver/web`) |
| folders | by their paths | uploaded or dropped; where they lie is worked out |
| can | everything | scan; and, switched on by its user in Chrome or Edge, fix samples, undo, and keep a history (see [Fixing in a browser](#fixing-in-a-browser)) |
| plug-ins | with what is installed | which are used, and where; installed or not is `unknown` |

What an engine cannot do is in its `capabilities`, and asking for it fails as `Unsupported`, so
a screen shows and explains it instead of hiding it. An engine that is gone (livesaver was
stopped, or started again, which gives its page a new token) fails as `Unreachable`; the app
notices that in one place, whichever screen asked. One suite of tests
(`apps/web/test/engine.conformance.test.ts`) runs the same scenarios against both, and demands
that both show the same for the same library. The browser's engine runs in it twice: reading
only, and with fixing switched on over a project folder that can be edited. The engines that
write (livesaver, and the browser with fixing switched on) share the scenario of a fix and its
undo (`engine.writing.test.ts`).

## How it is built
- **The page** (Vue, Pinia, Nuxt UI in Vue mode, Tailwind) holds the state in stores (engine,
  library, scan, fix, plug-ins, history) that talk to the engine; the stores and everything they
  compute are plain TypeScript, tested without a browser. The history store has the one list of
  runs: the last fix and the last upgrade that can be undone are read from it, and every undo
  goes through it, one at a time.
- **An engine worker** runs the scan (`scanFolders` in `@livesaver/web`), so the page stays
  responsive. The files of the folders stay with the page; the worker asks for each one it reads.
- **Parse workers** (started by the engine worker) gunzip the sets and find their references
  and plug-ins.
- **Nothing is fetched from elsewhere.** Icons and the font are part of the build, and a test
  fails on any request that leaves the page's own address: the app promises that nothing leaves
  the computer.
- **For everyone.** Every scrolling area can take the keyboard's focus, the whole flow from scan
  to undo works without a mouse, and axe finds no barrier on any screen, in light and dark. A
  message of failure is red in its icon and frame, and in the colour of text in its words:
  red words on a red ground cannot be read.
- **Two files of script**: what comes from libraries (which a new version of the app rarely
  changes), and the app. Together about 320 kB compressed.
- `bun run web` is Vite's development server with livesaver's API behind it. `bun run build`
  builds the app and copies it (without source maps) into the command line's package, which is
  what `livesaver web` serves.

## Folders in a browser
A page gets a folder in one of three ways (`packages/web/src/source.ts`):

| How | Browsers | What the page gets |
|---|---|---|
| folder upload (`<input webkitdirectory>`) | all | every file of the folder at once; nothing is uploaded anywhere |
| drag and drop (entries API) | all | the folder's entries; the page lists them and fetches a file when it is read |
| `showDirectoryPicker` (File System Access API) | Chrome, Edge (off by default in Brave) | a handle; folders are listed and files opened on demand |

`WebFs` mounts these folders at absolute paths and implements the read-only `FsRead` port.

**The page takes uploads and drops, not handles**, with one exception: a project folder that is
to be fixed in the page (below). A handle is convenient (no "upload" question, nothing listed
up front) and the only way a page can write, but Chromium does not show everything through it:
- Entries with names it considers unsafe are left out without a word: a name with a `:` (which
  Finder shows as `/`, as in a sample folder "Claps/Snares"), a name that starts or ends with a
  space (" (Freeze).wav" and the like occur in real projects), `desktop.ini` and a few more. In
  a real music folder that hid 5,220 of 108,423 entries, among them three whole sample folders,
  and the check then called samples missing that are there.
- No handle is given for a folder in `/Applications` (where Live's `App-Resources` lies), nor for
  the home, Documents or Desktop folder itself.

Uploads and drops show every file. In a real project folder (299 projects, 46,507 files) a
handle hides 118 files: 36 samples, their analysis files, and Finder's icon files; no set and
no folder. So a handle is acceptable there, with that said to the user; sample folders stay
uploads and drops.

**Files are fetched lazily.** For an uploaded folder even reading a file's size costs a round
trip to the browser (about 60 µs), and sending a `File` object to a worker about 30 µs: touching
all 290,000 files of a library up front froze the page for 17 s. So the engine gets only the
paths; it asks the page for a file when it needs its size or content (about 1,700 files in a run
over 876 sets). `FsRead.kind` answers "file or directory?" from the listing alone, which is all
that the existence checks of the 104,000 references need. A dropped folder is only listed, too
(about 2 s for 100,000 files): fetching each of its files (`FileSystemFileEntry.file()`) costs
about 180 µs, most of a minute for a library.

## Fixing in a browser
Off unless the user switches it on in the Settings (kept in the browser's `localStorage`), after
a dialog that lists the limits below and wants a tick. Only where the browser has
`showDirectoryPicker` and a private file system for the page (Chrome, Edge).

- **The same pipeline as `collect --apply`.** `fixFolders` (`packages/web/src/engine/fix.ts`)
  runs `doctor` with the command line's `applyWriter`, over a host whose write port
  (`WebFsWrite`, `packages/web/src/write.ts`) writes through the handles of the project folders.
  Sample folders are never written to. A file appears when its stream is closed (the browser
  writes a swap file and moves it into place), so there is no half-written set or copy.
- **A project folder is chosen for editing**: the folder dialog with `readwrite`, or a drop,
  whose handle can only be read until the user allows more (the browser asks in answer to a
  click). The page says for every project folder what it may do in it.
- **The run is kept in the page's own storage** (the origin's private file system, in a folder
  `livesaver`): the journal, written ahead and flushed line by line, the original of every
  rewritten set, the reports, and what was asked (`run.json`), named and laid out as the command
  line's run folders. The History reads it from there, also after a reload. The browser is asked
  to keep the storage when the disk gets full.
- **Undo is the command line's `undoRun`** over the same ports. It needs the folder the run
  changed among the folders the page has, at the same path, and refuses before it touches
  anything if a path of the journal lies elsewhere. A page has no Trash: copies that an undo
  takes out are moved to `.livesaver-trash/<time>/…` in the project folder, which a scan skips
  like every hidden folder.
- **One run that writes at a time**, across the tabs of the page (Web Locks); a scan does not
  start while one runs.
- **Places must be known.** A fix writes absolute paths into the sets: of the project, and of a
  pack that keeps its large files and Max devices. A project folder, or a folder with the
  Factory Packs or Live's content, that was placed at a stand-in path refuses the fix; the
  review says so before, and shows where it takes the project folders to lie.
- **A set that changed since it was read is not written.** A file behind a handle is fetched
  anew when its state is asked, so a set that Live saved between the reading and the writing is
  noticed (size and time), as on the command line.

What a page cannot do, and says before the switch goes on:

| | On this computer | In a browser |
|---|---|---|
| Live is running | checked, and a fix refuses | cannot be seen: the user confirms it in every review |
| Finder tags and comment of a rewritten set | kept (the file is replaced through a clone) | lost: the browser's write makes a new file |
| time of a copied sample | that of its source | that of the copying (the set says the same) |
| date of a rewritten set | that of the fix; an undo puts the old one back | that of the fix; an undo cannot put the old one back |
| what an undo takes out | the Trash | a hidden folder in the project folder |
| free space | checked | unknown |
| names with `:`, or a space at an end | seen and written | hidden from the page, and a file cannot be made with such a name: the set is left alone, with the reason |
| what an undo needs | livesaver's state folder | the browser's storage for the site: cleared with the site's data |
| plug-ins | upgrade, with undo | not at all: a page does not see what is installed |

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
Recognised by name among the given folders (`packages/web/src/engine/ableton.ts`), and named on
their rows as soon as a folder is added; what is still missing is listed under the sample
folders.

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
- A scan is read-only: nothing is collected or rewritten, and patched sets are only counted,
  not scanned strictly (`quickPlan`). (A fix in the browser scans every set it writes strictly,
  like the command line.)
- Plug-ins: which are used and where, not whether they are installed (a page cannot see that).
- Only the given folders are seen. The command line sees the whole disk.
- Symbolic links are not seen: a browser leaves them out of a dropped folder. The command line
  indexes links to files.
- No preferred folders for ties between identical copies, no cache of complete sets.
## How it is tested
- `packages/web/test`: `WebFs` over fake handles, uploads and listings; a `doctor` run over the
  browser host equals a run over the Node host on the fixtures; the scan (locating, Ableton's
  folders, the Live app given as a folder, the remap table, the plug-ins, the shaped result);
  and the conversation between the page and the engine's worker. Writing through handles
  (`WebFsWrite`) over folders in memory that behave like a browser's; a fix through them
  against the command line's pipeline on the same fixtures (the same references in the set,
  the same files with the same content), its run in the page's storage, its undo byte for
  byte, and what it refuses.
- `packages/cli/test`: what the page asks of this computer, on temporary copies of the fixtures:
  a check, a scan, a fix of all, of some and of one project, with and without the uncertain
  matches, an upgrade of plug-ins, undo, the history and its reports, and that the server
  answers only its own page.
- `apps/web/test`: the two engines against one suite (see above); the stores (library, scan,
  review, fix, undo, the history, a page that is opened again) against both engines; the app's
  own sums and words (states, plans, advice, what a run was and what its undo does).
- `bun run test:web`: the built app in Playwright's Chromium, WebKit and Firefox, 219 tests.
  - On its own: folders through the folder upload and by drops (with names a handle would hide,
    and an app as a folder; drops only in Chromium, which lets a test drop a folder), the
    overview, the tabs with search and filters, the side panels, a downloaded report, the hints.
  - With livesaver: a folder chosen in the page, a fix of one project after its review, undo, a
    selection fixed in one run, all fixed, the scan and the last fix still there after a reload,
    the uncertain matches left out; the files on disk are compared each time.
  - Plug-ins: the set Live saved with VST2 and VST3 devices is upgraded after a review and
    undone, byte for byte; what the sets use against a made-up set of installed plug-ins, and
    what breaks if one is uninstalled; on its own, the app says what it cannot know there.
  - The history: runs from before (a plan of the command line, a run of an older version), a
    fix made on another page with the undo in its toast, every run with its details, a report
    downloaded, a step shown in Finder, an undo that asks first and is then seen everywhere.
  - The settings: what livesaver found, a folder shown in Finder, the reset to the command
    line's settings; what every page says when livesaver is gone, or was started again.
  - Fixing in the page (Chromium): the switch and its dialog, a folder that can only be read,
    a folder of the disk that is dropped (read through its handle at once, and refused for
    editing by the test browser, which the page says), a fix after the review, compared with
    what `livesaver collect --apply` writes on the same projects on disk (the same references,
    the same copies, the same backup), the history, the undo, a reload. WebKit and Firefox say
    that they cannot. No test browser lets a page write to a folder of the disk without a
    person saying yes (the headless one refuses, the full one waits for its prompt), and the
    folder dialog cannot be driven: the project folder that is fixed in this test lies in the
    browser's private file system, behind the same handles. **Writing to a folder of the disk
    through a browser's permission is not covered by a test**; it is tried by hand.
  - A library of real size (299 projects, 876 sets, 9,305 planned changes, 2,243 missing
    samples, 199 plug-ins; made up from a small real scan): a table builds fewer than 80 rows,
    scrolls to its end without a frame of half a second, and is sorted and searched at once.
  - The whole flow from scan to undo with the keyboard alone, the keys of the tables, and an
    undo from the history; no barrier that axe can find on any screen, in light and dark; no
    error in the page; no request to another address; no motion for who asked for less.
  - The tests load the production build: a test runner's `NODE_ENV` would otherwise make Vite
    build Vue's development version.
  - Whether Live runs is told to the server by each test (`liveRunning`), so the tests do not
    depend on the machine they run on; told that it runs, the review does not let a fix start,
    and an undo is refused.
  - A page from one address connected to livesaver at another: the pairing link, a fix and
    its undo across the two, a reload that stays connected, disconnecting; a livesaver that was
    not started for pairing, and one of another version.
  - What a test waits for gets three times as long on a CI, whose machines are slower in
    spurts.
- `bun run test:node`: the built `livesaver web` under Node.js serves the app it ships with.
- On a real library (876 sets, 138,662 indexed files), read-only:
  - A scan in the app takes 13 s and shows the numbers of the command line: what `doctor`
    counts, and for a fix without the uncertain matches what `doctor --certain-only` counts.
  - A scan equals the three commands it stands for: its report files those of `doctor --full`,
    its 199 plug-ins (order, state, instances, sets) those of `plugins audit`, and its upgrade
    plan (386 rows) that of `plugins upgrade`. The plug-in screens show these numbers, and the
    257 installed plug-ins of `plugins list`.
  - On its own, given the project folder and the folders the command line searches with their
    paths typed, the report files are byte-identical to those of `livesaver doctor`, apart from
    the time stamp; with the Live app dropped and no path typed, the numbers equal the command
    line's. (Measured with the page this app replaced; the engine is the same code.)
  - Fixing is never tried there: it is tested on temporary copies.
