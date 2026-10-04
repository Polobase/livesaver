# Verification

What is checked, and how to repeat it. Checks on a real library are read-only; everything that
writes runs on temporary copies.

## Tests (`bun test`)
- **Live-saved fixtures** (`fixtures/`, see [fixtures/README.md](../fixtures/README.md)):
  - `Brokenpath Project`: after `collect --apply`, its references are byte-identical to what Live's
    own "Collect All and Save" wrote (`Fixed Path Project`), and the rest of the set is unchanged.
  - `VST2toVST3 Project`: Live saved each plug-in once as VST2 and once as VST3. The conversion
    matches Live: Massive keeps its parameters and automation, Omnisphere's wrapped state is
    byte-equal to Live's, and Serum's parameter list is reset.
  - `samples/Lib1/Kick/1.wav`: the CRC livesaver computes equals the `OriginalCrc` Live stored.
- **Every write path** (collect, VST2 → VST3, status, rating sheet, reorg, move, codemods) has
  tests that apply it in a temp folder and then run `undo`.
- **Property tests** for the XML scanner and patcher: random edits are applied, written and read
  back; an empty patch round-trips byte-identically.
- `bun run test:node` runs the built CLI under Node.js (collect + undo, status + undo, the
  web server).
- **Output in a pipe**: `doctor --json` over 400 sets through a shell pipe must arrive whole.
  (Under Bun, `console.log` dropped what a pipe could not take at once, 64 KB, as soon as
  `process.stdout` had been looked at; the command line writes through the stream instead.)
- `bun run test:web` runs the built web app in a headless browser: on its own (read-only), and
  with livesaver behind it, where it fixes one project, undoes, and fixes all on temporary
  copies, upgrades plug-ins, and undoes runs from the history. Fixing in the page itself
  (Chromium) is compared with `livesaver collect --apply` on the same projects, and an upgrade
  of plug-ins in the page with the set livesaver writes; the folder lies in the browser's
  private file system, since no test browser lets a page write to the disk without a person
  (see [web.md](web.md#how-it-is-tested)). Shown a plug-in folder and Live's database folder,
  the page says of the plug-ins what livesaver says. A scan of the size of a real
  library (9,305 planned changes) must stay quick in its tables. On a real library its report
  files are byte-identical to the command line's (see [web.md](web.md)).

## Corpus round trip
`LIVESAVER_CORPUS=<folder> bun test corpus` (read-only): every Live document below the folder,
backups included, must decode, scan and round-trip byte-identically through an empty patch. On
every 7th file the references are cross-checked against an independent regular expression, and
the plug-ins read from the plug-in devices alone (`pluginUses`) against those of the full
analysis.

| Corpus | Files | XML | Result |
|---|---:|---:|---|
| a music folder (sets and backups) | 3,350 | 43.8 GB | all decode, scan, and round-trip byte-identically; 1,267,218 references; 479 files cross-checked against an independent regular expression, and their 1,210 plug-ins against the full analysis |
| `~/Music/Ableton` (`.adg/.adv/.alc/.agr/.als`) | 10,100 | 8.0 GB | same; 13 old binary grooves reported as unsupported |
| a music folder, every set and backup: `pluginUses` against `analyzeSet` | 3,350 | 43.8 GB | the same plug-ins and instance counts in every file (8,368 in all), in 11 s of CPU instead of 144 s |

## Speed
On a library of 842 sets (804 MB gzipped, 11.9 GB of XML), Apple Silicon, 8 cores:

| Command | Time |
|---|---:|
| `doctor`, full scan with the element index | 34 s |
| `doctor`, reference search instead of a full scan | 14 s |
| `doctor`, plus parse workers | **7.0 s** cold, 3.3 s with the complete-sets cache |
| `status` (827 sets, dry run) | 12 s |
| `plugins audit` (876 sets), full analysis of every set | 11 s |
| `plugins audit`, plug-ins read from the plug-in devices alone | **3.4 s** |
| `plugins upgrade` (876 sets, dry run), one set at a time | 8.4 s |
| `plugins upgrade`, parse workers, rack and automation ids found by string search | 7.1 s |
| a scan of the web app (samples and plug-ins, 876 sets) | 12.5 s |
| `index` | 12.4 s the first time, **0.6 s** when nothing changed |
| under Node (built `dist`) | same pipeline, worker threads included |

Scanner: ~495 MB/s per core on a 45 MB set (611k elements). Native byte search: ~10 GB/s.

Open: a warm `doctor` under 2 s needs the collect decisions cached across runs.
