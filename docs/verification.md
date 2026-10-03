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
- `bun run test:node` runs the built CLI under Node.js (collect + undo, status + undo).
- `bun run test:web` runs the built web app in a headless browser; on a real library its report
  files are byte-identical to the command line's (see [web.md](web.md)).

## Corpus round trip
`LIVESAVER_CORPUS=<folder> bun test corpus` (read-only): every Live document below the folder,
backups included, must decode, scan and round-trip byte-identically through an empty patch.

| Corpus | Files | XML | Result |
|---|---:|---:|---|
| a music folder (sets and backups) | 3,204 | 45.5 GB | all decode, scan, and round-trip byte-identically; 1,288,785 references; 458 files cross-checked against an independent regular expression |
| `~/Music/Ableton` (`.adg/.adv/.alc/.agr/.als`) | 10,100 | 8.0 GB | same; 13 old binary grooves reported as unsupported |

## Speed
On a library of 842 sets (804 MB gzipped, 11.9 GB of XML), Apple Silicon, 8 cores:

| Command | Time |
|---|---:|
| `doctor`, full scan with the element index | 34 s |
| `doctor`, reference search instead of a full scan | 14 s |
| `doctor`, plus parse workers | **7.0 s** cold, 3.3 s with the complete-sets cache |
| `status` (827 sets, dry run) | 12 s |
| `plugins audit` (827 sets) | 12 s |
| `index` | 12.4 s the first time, **0.6 s** when nothing changed |
| under Node (built `dist`) | same pipeline, worker threads included |

Scanner: ~495 MB/s per core on a 45 MB set (611k elements). Native byte search: ~10 GB/s.

Open: a warm `doctor` under 2 s needs the collect decisions cached across runs.
