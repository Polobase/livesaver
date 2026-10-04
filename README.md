# livesaver

**Keep your Ableton Live projects alive.** Find and relink missing samples, batch *Collect All and
Save* across hundreds of projects, move VST2 plug-ins to VST3, audit plug-ins, and search your whole
library, all without Live running. Fast, byte-exact, and safe by default.

> Status: **0.1.0 in preparation** (milestones M0–M7 done, M8 begun): `doctor`, `collect [--apply]`,
> `undo`, `plugins upgrade|list|audit`, `status`, `reorg`, `move`, `index`, `find`, `sql`, `run`,
> and a web app that scans your projects, reviews a fix with you, fixes and undoes.
> Tested against sets saved by Live itself and on a real 842-set library (read-only round trips
> of 13,000 Live documents). See [docs/verification.md](docs/verification.md).

**[polobase.github.io/livesaver](https://polobase.github.io/livesaver/)**: what it does, the
guide, and the app to try in your browser. New here? Start with the
[guide](docs/guide/getting-started.md): from the first scan to an undo.

## Quick start
```sh
livesaver env                          # what livesaver found: Live, User Library, packs, search roots
livesaver doctor ~/Music/Projects      # read-only: missing/external samples and Max devices, per set
livesaver collect ~/Music/Projects     # dry run of "Collect All and Save" for every project, with reports
livesaver collect ~/Music/Projects --apply   # really do it (quit Live first)
livesaver runs                         # past runs, with their reports and journals
livesaver undo <run>                   # restore the sets of a run; unused copies go to the Trash
livesaver web                          # scan, review, fix and undo in the browser
livesaver plugins upgrade ~/Music/Projects [--apply]   # VST2 → VST3 for verified plug-ins
livesaver index ~/Music/Projects               # catalog every set (later runs read only changed sets)
livesaver find plugin:serum bpm:120..128 stage:arranged missing:samples
livesaver sql "SELECT name, tempo FROM sets ORDER BY seconds DESC LIMIT 5"
livesaver run set-tempo ~/Music/Projects --option bpm=124 [--apply]   # codemods: built-in or your own
livesaver plugins list                         # installed plug-ins: formats, native or Rosetta, versions
livesaver plugins audit ~/Music/Projects       # missing, Rosetta-only, native alternatives, unused …
livesaver plugins audit ~/Music/Projects --uninstall Massive   # … and what breaks without a plug-in
livesaver status ~/Music/Projects [--apply]    # progress and completeness as Finder tags and comments
livesaver reorg plan ~/Music/Projects          # sort projects into folders by their decision tag …
livesaver reorg run <plan.csv> [--apply]       # … after you checked the plan
livesaver move plan ~/Music/Projects           # sets saved into another song's project …
livesaver move run <plan.csv> [--apply]        # … move into a project of their own
```
Reports are written as CSV (for Excel) and Markdown.

### Search your library
`livesaver index` reads every set once into a catalog (SQLite); later runs read only changed sets
and re-check the rest in under a second. `livesaver find` then answers right away:

| Term | Matches sets … |
|---|---|
| `kick` `"night drive"` | whose name, project, plug-ins, samples or locators contain the words |
| `plugin:serum` `format:vst2` | using a plug-in (name or id), or a plug-in format |
| `sample:snare` `device:lfo` | referencing a sample or Max device by name |
| `stage:arranged` | at a progress stage (empty, session, sketch, arranged, elaborated) |
| `missing:samples` `missing:plugins` `rosetta:yes` `complete:yes` | by completeness |
| `bpm:120..128` `length:>3:00` `bars:>=64` `tracks:<8` `clips:>20` `automation:>10` | by numbers |
| `live:12` `live:11.3` `modified:2024` `modified:>2025-06` | by Live version or date |
| `project:studio` `path:archive` `has:locators` `duplicate:yes` | by place or features |
| `-stage:empty` | negated |

`livesaver sql` runs read-only SQL on the same tables (`sets`, `set_plugins`, `refs`, `set_refs`).

### Codemods
Change many sets at once with a few lines of TypeScript: typed views over tracks, devices, tempo
and locators, plus byte-exact patch primitives. Dry run by default; `--apply` backs up, journals and
checks every set, and `livesaver undo` reverses it. See [docs/codemods.md](docs/codemods.md).

```ts
import type { Codemod } from 'livesaver'
export default {
  name: 'mastering-off',
  transform(set) {
    for (const d of set.master()?.devices() ?? []) if (d.type === 'Limiter') d.setOn(false)
  },
} satisfies Codemod
```

### Plug-in audit
`livesaver plugins audit` reads every set and matches each plug-in by id, as Live does, against
what is installed (Live's plug-in database, Audio Units, bundles Live has not scanned yet):
- missing plug-ins, and plug-ins that load only under Rosetta (Intel-only binaries);
- the same plug-in installed in another format, natively: linked by the VST3 compatibility a
  bundle declares, Steinberg's VST2→VST3 ids, JUCE's and iPlug2's default ids, or the AU code;
- VST2 plug-ins whose VST3 is installed, and whether `plugins upgrade` has a verified conversion;
- installed plug-ins no set uses, and with `--uninstall <name>` which sets would break.

### Project status in Finder
`livesaver status` measures every set (arrangement length, distinct 8-bar blocks, automation,
missing samples, missing or Intel-only plug-ins) and marks sets and project folders in Finder:
- one progress tag (Empty, Session only, Sketch, Arranged, Elaborated), completeness tags
  (Complete, Samples missing, Plugins missing, Rosetta), Export and Duplicate;
- a one-line comment with the facts ("Arranged · 5:12 · 124 BPM · 14 tracks · Live 12.4 · complete").

Your own tags (a decision like *Continue* or *Delete*, stars) and anything you write after `‖` in a
comment stay untouched. An optional rating sheet (CSV) lists every project; decisions, stars and
notes you type there become tags and comments on the next run. Folders, tag names, decisions,
stars and thresholds come from `~/.config/livesaver/config.json` (`livesaver init` writes one for
your Live setup):

```json
{
  "status": {
    "projects": "~/Music/Projects",
    "exports": "~/Music/Exports",
    "sheet": "~/Music/Projects/Ratings.csv",
    "stages": { "sketch": "Draft" },
    "decisions": [{ "name": "Continue", "folder": "1 In Progress", "colour": 2 }]
  }
}
```

### In the browser
`livesaver web` opens the web app (from the repository: `bun run web`). It scans like `doctor`
and `plugins audit` in one go and shows the whole picture: how many sets are complete, what a
fix would do, what stays missing and where it came from, with advice per source; every project,
set, planned change and missing sample in tables you can search. **Review and fix** does what
`collect --apply` does, for all projects, a selection or one: it shows first what will change,
lets you leave uncertain matches out, checks that Live is closed and that there is room, and a
fix can be undone there, like `livesaver undo`. The plug-in screens show what your sets use
against what is installed (not installed, Rosetta only, unused, what breaks if you uninstall
one), and upgrade VST2 plug-ins to VST3 like `plugins upgrade --apply`, with the same review
and undo. The **History** lists every run that changed something (those of the command line
too), with its reports and every step, and undoes a run like `livesaver undo`.

The app talks to livesaver on your computer, which reads and writes the files with your
settings: nothing leaves the computer, and only the page that livesaver served can ask it for
anything.

`livesaver web --pair` opens the app on livesaver's site instead, connected to the livesaver of
your computer, where the browser allows a site to reach it: Chrome, Edge and Firefox ask, Brave
wants the site allowed in its settings, Safari does not. The page says what its browser needs.

The same app also runs without livesaver behind it, on its own in a browser (Chrome, Safari,
Firefox). Then you choose or drop the folders and it scans them by itself, read-only. (In Chrome
and Edge it can also fix in a project folder you let it edit: an experiment with limits, off
until you switch it on. See [In the browser](docs/guide/browser.md).) A browser
does not tell a page where a folder lies on disk: livesaver works that out for project folders
from the sets themselves. Drop the Ableton Live app on the page as well: it holds the Core
Library and Live's own list of content it moved between versions, and with it the page reports
what the command line reports.

## Why livesaver
- **Byte-exact edits.** Only the bytes that must change do change; everything else in a Live Set
  stays identical. Nothing is ever re-serialized.
- **Live's own matching.** Samples are identified the way Live identifies them: file size plus
  Live's CRC-16 over the first 16 KB. The name alone is never enough. Vendor re-saves and Ableton's
  in-place pack updates are handled explicitly. `--match-library-path` also accepts a library file
  with other tags by its name and place in the library, and reports it as uncertain;
  `--certain-only` takes no file that the fingerprint does not confirm.
- **Every format.** Reads `.als`, `.adg`, `.adv`, `.alc` and `.agr` from Live 8.2 to 12, including
  old (Live 9/10) and new FileRef formats, macOS aliases and Windows paths.
- **Safe by default.**
  - It only plans unless you pass `--apply`, and refuses to write while Live runs.
  - Backups follow Live's scheme (`Backup/<set> [date time].als`).
  - Writes are atomic and keep Finder tags and comments. A rewritten set carries the date of the
    fix, its backup the date it had; an undo puts the old date back.
  - Every run is journaled, and `undo` works even after Live has pruned its backups.
  - Nothing is ever deleted.
- **Fast.** Reference search runs at ~10 GB/s, sets are parsed on all cores, complete sets are
  cached, and copies are APFS clones (no extra disk space, under Bun).
- **Library-first.** A typed API for Node.js, Bun and the browser, a CLI, and JSON output.

## Packages
| Package | What it does |
|---|---|
| [`@livesaver/xml`](packages/xml) | Lossless byte-level XML scanner, element index and patcher (no dependencies) |
| [`@livesaver/core`](packages/core) | Ableton Live formats: documents, FileRefs, paths, CRC, fingerprints |
| [`@livesaver/ops`](packages/ops) | Operations: doctor, collect, status, reorg, move, journal and undo, reports |
| [`@livesaver/plugins`](packages/plugins) | Plug-in identity and inventory (installed, native or Rosetta), byte-exact VST2→VST3 conversion |
| [`@livesaver/catalog`](packages/catalog) | Catalog of sets, plug-ins and samples in SQLite (FTS5), incremental indexing, the `find` language |
| [`@livesaver/node`](packages/node) | Node.js/Bun host: file system, gzip, worker threads, Finder tags and comments, Live setup discovery |
| [`@livesaver/web`](packages/web) | Browser host: uploaded, dropped or picked folders as a file system, worker-based parsing, a scan of samples and plug-ins in the page, and a fix through folder handles |
| [`livesaver`](packages/cli) | The command-line tool |
| [`apps/web`](apps/web) | The web app: Vite, Vue, Nuxt UI (not published) |
| [`apps/site`](apps/site) | The site: landing page and the docs as pages (Nuxt, static; not published) |

## Roadmap
| Milestone | Delivers |
|---|---|
| ✅ M1 | read-only `doctor` |
| ✅ M2 | `collect --apply`, journal and `undo`, reports |
| ✅ M3 | VST2 → VST3 upgrade (`livesaver plugins upgrade`) |
| ✅ M4 | project management: `status` (Finder tags, comments, rating sheet), `reorg`, `move` |
| ✅ M5 | plug-in inventory and audit (`plugins list`, `plugins audit`) |
| ✅ M6 | catalog and search (`index`, `find`, `sql`) |
| ✅ M7 | codemods (`livesaver run`) |
| 🚧 M8 | web app (samples and plug-ins: scan, review, fix, upgrade, undo, history) and a site with guides: done; Finder Quick Actions: next |

## Development
```sh
bun install
bun run livesaver doctor ~/Music/Projects   # the CLI straight from source, no build needed
bun run build      # tsc, dependency order
bun test           # unit, property and end-to-end tests
bun run check      # biome + typecheck
bun run test:node  # the built CLI under Node.js
bun run web        # the web app while working on it, on http://localhost:5173/
bun run test:web   # the web app in Chromium, WebKit and Firefox (bunx playwright install, once)
bun run site       # the site (landing page and docs) while working on it
bun run test:site  # the built site in the three browsers
```

## License
MIT © Manuel Haller Polo. livesaver is not affiliated with or endorsed by Ableton AG. "Ableton" and
"Live" are trademarks of Ableton AG.
