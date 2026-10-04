# The web app

`apps/web` is one app (Vite, Vue, Nuxt UI) that runs in two situations:

- **With livesaver on the same computer** (`livesaver web`, or `bun run web` in the repository):
  the computer reads the folders by their paths and scans them like `livesaver doctor` and
  `livesaver plugins audit`, and it can fix what it finds like `livesaver collect --apply`: all
  projects, a selection, or one, after a review, with an undo. See
  [On this computer](#on-this-computer).
- **On its own in a browser** (any static host): it is handed folders and scans them itself
  with the same code (`@livesaver/ops`) on a browser host (`@livesaver/web`). It only reads,
  unless its user switches fixing on where a browser lets a page edit a folder (Chrome, Edge):
  then it fixes samples and upgrades plug-ins itself, with a backup of every set and an undo.
  The sections from [How it is built](#how-it-is-built) to
  [What differs from the command line](#on-its-own-what-differs-from-the-command-line) are
  about this.

The same files serve both: relative URLs and hash routes, so they run at any path. What the app
cannot do where it runs is shown and explained, not hidden: on its own it says how it can fix
from there, for the browser it is in.

Fixing in the page is an experiment behind a switch. Writing needs the File System Access API,
which Safari and Firefox do not offer (Brave only behind a flag) and whose handles hide files;
and a page cannot see that Live is running. See [Fixing in a browser](#fixing-in-a-browser).

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
reads (unless fixing in the page is switched on); `livesaver web --pair` connects it to the
livesaver of the same computer:

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
- **A browser has the last word.** Chrome, Edge and Firefox ask the user whether the page may
  reach this computer. Brave refuses without asking, unless the site was allowed under
  `brave://settings/content/localhostAccess`. Safari does not allow it: to WebKit, a request to
  `http://127.0.0.1` from a page of an `https` site is mixed content. While a browser asks, the
  page says that it is connecting. A browser that refuses says nothing, and to the page that is
  the same as a livesaver that is gone: it says that livesaver does not answer, what this
  browser needs, and links to livesaver's own address, which serves the same app and which any
  browser opens (going there is no request of a page). Either way it can go on on its own.
  Checked with the app as deployed on the site: Chromium connects and scans once that
  permission is given, and WebKit refuses.
- **The page says it for the browser at hand** (`lib/ways.ts`): for each of the two ways a page
  can fix (connected, or editing the folder itself) whether it works, works after a step in the
  browser's own settings, or does not. Brave is known by `navigator.brave` (its user agent is
  Chrome's), the others by their user agents. A page cannot link to a browser's settings
  (`brave://…`), so those addresses are shown to be copied. The dialog also takes a pairing
  link that is pasted, and connects the tab that is open.
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
| can | everything | scan; and, switched on by its user in Chrome or Edge, fix samples, upgrade plug-ins, undo, and keep a history (see [Fixing in a browser](#fixing-in-a-browser)) |
| plug-ins | with what is installed | which are used, and where; installed or not if it was handed the folders that say so (see [What is installed, in a browser](#what-is-installed-in-a-browser)), else `unknown` |

What an engine cannot do is in its `capabilities`, and asking for it fails as `Unsupported`, so
a screen shows and explains it instead of hiding it. An engine that is gone (livesaver was
stopped, or started again, which gives its page a new token) fails as `Unreachable`; the app
notices that in one place, whichever screen asked. One suite of tests
(`apps/web/test/engine.conformance.test.ts`) runs the same scenarios against both, and demands
that both show the same for the same library. The browser's engine runs in it twice: reading
only, and with fixing switched on over a project folder that can be edited. The engines that
write (livesaver, and the browser with fixing switched on) share the scenarios of a fix and of
an upgrade of plug-ins, each with its undo (`engine.writing.test.ts`).

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
| `showDirectoryPicker` (File System Access API) | Chrome, Edge (in Brave behind `brave://flags/#file-system-access-api`) | a handle; folders are listed and files opened on demand |

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
no folder. Sample folders stay uploads and drops; a project folder that is to be fixed needs
its handle, and the page makes up for what the handle hides:

- **A sample the handle hides is not a missing sample.** The first real fix in a page showed
  what happens otherwise: 41 samples that lay where their sets expect them counted as missing,
  were "found" elsewhere, and were to be copied to the names the browser refuses. The fix
  failed for all 48 sets it touched, and said it had copied the 23 files it had planned to
  (it had copied none: a copy now counts once it is made). So the file system says
  where it sees nothing and where it can make nothing (`FsRead.hides`, `FsRead.refuses`), and
  a set is planned by that (`processSet`, `Choice.blind`):
  - `unseen`: a place where Live would look for the file is hidden. The file may be there:
    nothing is looked for in its place, and the reference is left alone.
  - `unmade`: the file was found, and would be copied to a name the browser does not make.
    Another place in the project is taken if there is one (`Project.places`); otherwise the
    reference is left alone, with the file that was found as its candidate.
  - `locked`: the set itself has such a name, or lies in a folder with one. It is read (through
    a listing, see below) and checked, and nothing is done for it.

  Each of the three is listed with the missing samples under a source of its own, with what to
  do, and no set is planned to change for it: a fix then writes the sets it can, and fails for
  none.
- **A listing of the same folder shows what the handle hides** (`WebFs`: the handle is what is
  read and written, the listing what it leaves out). The page gets one in three ways:
  - The project folder is **dropped** rather than chosen in the dialog: a drop lists every
    file and comes with the handle (`editableFromDrop`; the source keeps the files the handle
    hides, `hidden`). The folder is then read in full from the start.
  - The same folder is given once more, as an upload or a drop, among the sample folders
    (`locate` takes it for the project folder: one place, read once).
  - A folder that holds the project folder is among the sample folders (a library folder).

  A place that a listing shows is not hidden, and still refused: a file there is seen, and
  none can be made.

**Files are fetched lazily.** For an uploaded folder even reading a file's size costs a round
trip to the browser (about 60 µs), and sending a `File` object to a worker about 30 µs: touching
all 290,000 files of a library up front froze the page for 17 s. So the engine gets only the
paths; it asks the page for a file when it needs its size or content (about 1,700 files in a run
over 876 sets). `FsRead.kind` answers "file or directory?" from the listing alone, which is all
that the existence checks of the 104,000 references need. A dropped folder is only listed, too
(about 2 s for 100,000 files): fetching each of its files (`FileSystemFileEntry.file()`) costs
about 180 µs, most of a minute for a library.

## Folders across a reload
A browser hands a page the files of a folder for one visit. What a page can keep
(`apps/web/src/engine/memory.ts`):

- **The lists**, with what was typed and ticked and how a scan matches: as text in the
  browser's storage for the site, written at once, so that a reload right after a change does
  not lose it. A folder that comes back as a row only waits to be added again; added again, it
  takes its place with its settings.
- **A folder's handle**, in the browser's database, where the browser handed one out: for a
  folder chosen for editing, and for a dropped folder, whose drop offers a handle beside its
  entries in Chromium (`kept` on a listing). A handle is read again on the next visit once the
  browser allows it (`queryPermission`, and `requestPermission` in answer to a click); one
  notice asks for all the folders that wait.
- **A dropped folder is read again through its handle only if that loses nothing.** A handle
  hides entries with some names; the listing of the drop shows them all, so the page knows how
  many files the handle would cost (`lostBehindHandle`). If any, the folder is not read through
  it: its row says how many files it is about, and asks for the drop again. On a real library
  that is one folder of five: 3,719 of its 83,993 samples have such a name, or lie below a
  folder with one.
- **No handle is kept in a private window.** A private window of Chromium (seen in 153) takes
  a handle into its database, never answers when the handle is asked back, and from then on
  answers nothing a page asks about folders (not even about its own file system) until the
  window is closed. A page is not told whether its window is private; it sees the room it is
  given, which is a share of the computer's memory there and 10 GiB or more elsewhere. Brave
  tells every page the same number and hands handles back in its private windows too (checked
  with Brave 1.96 itself). Should a browser not answer after all, the page gives its database
  one and a half seconds, goes on without, and does not ask again in that tab; and a drop does
  not wait for a handle that does not come.

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
  review says so before, and shows where it takes these folders to lie.
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
| names with `:`, or a space at an end | seen and written | seen if the folder was dropped (or is listed by a folder around it), otherwise left alone as "not shown by the browser"; never made: a copy goes elsewhere in the project, or the reference is left with the reason |
| what an undo needs | livesaver's state folder | the browser's storage for the site: cleared with the site's data |
| plug-ins | what is installed is looked up; upgrade, with undo | what is installed is what the page was shown; upgrade, with undo, once that includes Live's plug-in database |

**What goes to a worker is made anew.** A fix and an upgrade run in a worker, and are told which
projects or plug-ins were chosen. An app keeps such choices in a state that wraps them (Vue's
does), and a browser refuses to send a wrapped object to a worker: the engine sends copies. (A
fix of one project failed on that until a test went through the app's state instead of calling
the engine directly.)

## What is installed, in a browser
A page cannot look for plug-ins, but it can be shown them: the Settings take folders that say
what is installed (`installedIn` in `packages/web/src/engine/installed.ts`).

- **A plug-in folder** (`/Library/Audio/Plug-Ins`, or a folder above it): its `VST3`, `VST` and
  `Components` folders are read as the command line reads them (`loadInventory`), with the
  processors each bundle is built for.
- **The folder of Live's plug-in database** (`Live Database`): `Live-plugins-*.db` says which
  plug-ins Live scanned, by their ids and per processor. Without it a plug-in is known only if
  its bundle says which one it is (an Audio Unit; a VST3 with a `moduleinfo.json`), and the
  page says that the database is missing.
- **The database is read as a file.** A page has no SQLite. `readSqliteTable` in
  `@livesaver/core` reads a table from the file format itself (table b-trees, overflow pages,
  the row id that stands in for an integer key), and takes the write-ahead log beside the
  database into account: while Live runs, what it scanned last is only in there.
  `parsePluginDatabase` in `@livesaver/plugins` is the query the command line runs in SQL. On
  a real database both give the same rows (269 plug-ins, 288 modules).
- **Where the plug-in folder lies** a browser does not say, and the database names bundles by
  their paths: the folder is placed where most of those paths lead into it.
- **The Audio Units of macOS itself** lie in a system folder a page is not given: one that a
  set uses is taken to be there.
- **The upgrade to VST3** is the command line's `upgradePlugins` over the write port of a fix
  in the page, with the VST3 plug-ins Live knows taken from the database folder: without that
  folder there is no upgrade, and the page says what it needs. The run is kept and undone like
  a fix. An upgrade writes no path into a set, so it does not ask where the folders lie.
- **A plan that could not be made is made again after the next scan**: what stood in its way
  (no database folder) may have been added since.
- **On a real Mac**, read-only: shown its two plug-in folders (13,700 files) and Live's database
  folder, this code finds what the command line finds of the same folders: 354 plug-ins in
  three formats, each with the same id, place and processors, and the same 70 VST3 plug-ins
  Live knows. It takes a quarter of a second, once the browser has listed the folders.

## Where a folder lies on disk
A browser never tells a page a folder's path, but sets store absolute paths, and those are
compared with the folders' paths.

- **Project folders** are located from the sets: a reference stored relative to its project also
  names the file by an absolute path, which says where the project was when the set was saved.
  The folder is the one with its name in that path. Projects moved inside the folder since then
  do not matter; if the folder itself was renamed, its location is unknown.
- **Sample folders** that hold a project folder, or lie directly in one, are placed by it.
- **Ableton's own folders** (the Live app or one of its folders down to the Core Library, the
  User Library, the Factory Packs, or the folder that holds those two) are placed by the paths
  the sets store for files in them (`leadsTo` in `packages/web/src/locate.ts`): a stored path
  counts if it names the folder by its name and the file it names is in the folder. Live finds
  what lies in these folders by its own rules whatever the stored path says, so a stale path
  does no harm here, and a fix that names such a folder in a set should name it as Live would.
  Sets of older Lives name the app of their time: the sets of the newest Live decide, and more
  sets are read (up to 48) while only older ones gave a lead. On a real library the app's
  `Contents` folder and `Music/Ableton` are placed this way, in two seconds.
- **A path that is typed for a folder of the Live app** may be any path into the app (the app,
  its `Contents`, `App-Resources` or the Core Library): asked where "Contents" lies, one pastes
  the path of the app. The folder is placed at its own path in that app (`liveFolderPath`).
- Every other folder gets a stand-in path (`/<name>`), unless the user types its path. For a
  folder of the user's, other stored paths are no evidence: a path that no longer exists would
  move a folder to a place where it is not, and the missing file would then seem to exist,
  unchecked.

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
- Plug-ins: which are used and where. Whether they are installed only once the page was shown
  the folders that say so.
- Only the given folders are seen. The command line sees the whole disk.
- Symbolic links are not seen: a browser leaves them out of a dropped folder. The command line
  indexes links to files.
- No preferred folders for ties between identical copies, no cache of complete sets.
## How it is tested
- `packages/web/test`: `WebFs` over fake handles, uploads and listings; a `doctor` run over the
  browser host equals a run over the Node host on the fixtures; the scan (locating, Ableton's
  folders and where they lie by what the sets store, the Live app given as a folder, the remap
  table, the plug-ins, the shaped result);
  and the conversation between the page and the engine's worker. Writing through handles
  (`WebFsWrite`) over folders in memory that behave like a browser's; a fix through them
  against the command line's pipeline on the same fixtures (the same references in the set,
  the same files with the same content), its run in the page's storage, its undo byte for
  byte, and what it refuses. What is installed, from folders handed to a page, against the
  inventory the command line makes of the same folders; an upgrade of plug-ins through handles
  against the command line's pipeline (the same set, byte for byte), and its undo.
- `packages/core/test`, `packages/plugins/test`: Live's plug-in database read from its file,
  against SQLite on the same file: with rows that overflow a page, tables of several levels,
  and a write-ahead log that holds what the database does not have yet (also with a log from
  an earlier state, and one that ends in the middle of a change).
- `packages/cli/test`: what the page asks of this computer, on temporary copies of the fixtures:
  a check, a scan, a fix of all, of some and of one project, with and without the uncertain
  matches, an upgrade of plug-ins, undo, the history and its reports, and that the server
  answers only its own page.
- `apps/web/test`: the two engines against one suite (see above); the stores (library, scan,
  review, fix, undo, the history, a page that is opened again) against both engines; the app's
  own sums and words (states, plans, advice, what a run was and what its undo does). The
  folders across a reload, over a memory that is a list: what is kept, what waits for the
  browser's OK, what is to be added again and takes its settings back. In a
  browser that lets a page edit folders: one project fixed alone through the app's state, the
  folders that say what is installed, and an upgrade that is planned, written and taken back.
- `bun run test:web`: the built app in Playwright's Chromium, WebKit and Firefox, 270 tests.
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
  - The folders across a reload, with the browser's own database: in the three engines the
    lists with what was typed and ticked, a folder that is added again, one that is removed.
    In Chromium with a profile that is kept (a context of Playwright is a private window): a
    project folder chosen for editing is back and scanned; a dropped folder of the disk is
    back, and the test browser refuses when asked for it; one with names a kept folder would
    hide waits to be dropped again. In a private window no handle is kept, the page comes up
    at once, and its folder access keeps answering. **That a person's browser asks, and reads
    the folder once allowed, is not covered by a test**; it was seen in Brave itself, run with
    a profile of its own.
  - Where Ableton's own folders lie, in the three engines: the Live app's `Contents` folder and
    `Music/Ableton` are placed by what the sets store, and a path typed for the app's folder
    may be any path into the app. In Chromium, the review of a fix in the page shows those
    places and is ready without a path being typed.
  - What is installed, shown to a page, in the three engines: what the page says without the
    folders, with the plug-in folder alone, and with Live's database, where it says what
    livesaver says of the same plug-ins. In Chromium, an upgrade to VST3 that the page makes
    itself: what it needs first, its plan, the review, and the set it writes against the set
    livesaver writes for the same project on disk; the history, and the undo.
  - Fixing in the page (Chromium): the switch and its dialog, a folder that can only be read,
    a folder of the disk that is dropped (read through its handle at once, and refused for
    editing by the test browser, which the page says), a fix after the review, compared with
    what `livesaver collect --apply` writes on the same projects on disk (the same references,
    the same copies, the same backup), the history, the undo, one project fixed from the list
    of projects and taken back, a reload. WebKit and Firefox say
    that they cannot. No test browser lets a page write to a folder of the disk without a
    person saying yes (the headless one refuses, the full one waits for its prompt), and the
    folder dialog cannot be driven: the project folder that is fixed in this test lies in the
    browser's private file system, behind the same handles.
  - Fixing in a folder of the disk (`disk.e2e.ts`, Chromium as it is installed for people):
    "allow on every visit" is a setting of the browser for a site, so a profile is given that
    setting before the browser starts with it (the guards of the File System Access API in
    its `Preferences`), and the page is let in as it is for such a user. The folder is a
    temporary one, with the browser's real rules for names: dropped to be edited, it is read
    in full, the fix writes the set, its copy and its backup to the disk, and the undo puts
    them back; chosen "in the dialog" (the test answers the dialog with the handle of a drop),
    the sample the handle hides is left alone and said to be, the fix fails for no set, and
    the folder dropped as well shows the sample. **The prompt itself, and the folder dialog,
    are not covered by a test.**
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
  - How a page can fix: what each engine is told about itself (the two ways, and a pairing
    link that is pasted into a tab that is open), and what Brave is told. Brave cannot be driven
    by a test: it is made up in Chromium by what tells it apart (`navigator.brave`, and no
    folder to edit). Its two steps with the addresses to copy, a connection it keeps back, and
    the app at livesaver's own address one link away. **Whether Brave's own settings then let
    the page through is not covered by a test**; it is tried by hand.
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
