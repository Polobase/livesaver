# Fixtures

Files saved by Ableton Live, used by the tests as ground truth: what Live writes, and what Live
itself does (e.g. "Collect All and Save"), so livesaver's results can be compared with Live's.

Live stores the absolute path of every file a set uses, so a set shows the folder it was saved in.
Before a set is added here, `scripts/anonymize-fixture.ts` replaces that folder with
`/Users/someone/livesaver/fixtures` and changes nothing else; it refuses if the folder also hides in
binary data. Tests compare paths relative to the saved folder, so the fixtures work from any
checkout. These files are public with the repository: use only samples from `samples/`, and no
names from a real library. `fixtures/local/` is ignored by git, for originals and anything personal.

```sh
bun scripts/anonymize-fixture.ts --from <folder the set was saved in> \
  --to /Users/someone/livesaver/fixtures <file.als>…
```

## What is here

| Fixture | What it is | Tests |
|---|---|---|
| `projects/Brokenpath Project/Brokenpath.als` | Live 12.4.6; 4 clips use `1.wav` through a broken relative path (`../../samples/brokenpath/Lib1/Kick/1.wav`) | collect (relink, collect into the project), resolving and choosing candidates, FileRef parsing and patching, undo, cache |
| `projects/Fixed Path Project/Fixed Path.als` | the same set after Live's own "Collect All and Save": the sample in `Samples/Imported`, referenced project-relative; `Backup/` holds the set before | the expected result of `collect --apply` on Brokenpath; analysis (same content hash as Brokenpath) |
| `projects/VST2toVST3 Project/VST2toVST3.als` | Live 12.4.6; Massive, Serum and Omnisphere, each once as VST2 and once as VST3, so Live's own VST3 version of each plug-in is in the set; `Backup/` holds an earlier save | VST2 → VST3 conversion and its blockers, `plugins upgrade` with undo, plug-in analysis |
| `samples/Lib1/Kick/1.wav` (+ `.asd`), `samples/Lib2/Kick/1.wav` | the same 2,000,324-byte kick in two libraries (Live's analysis file only in Lib1); CRC 17226 as Live stores it | Live's CRC, fingerprints, choosing between equal files, copying `.asd` files |

## Built in code
For cases where the structure alone matters, `@livesaver/test-kit` builds small sets from the
elements Live writes (taken from real sets): `liveSet`, `midiTrack`, `audioTrack`, `midiClip`,
`automation`, `arranged` (analysis, status, rating sheet, catalog, codemods), `OLD_SET`, `LIVE9_SET`,
`deviceSet`, `amxd` (Live 9/10 FileRef formats, Max devices), `sampleSet`, `foreignRef` (move,
reorg), and `fakeOsascript` (Finder comments without Finder).

## Wanted: cases only Live can save
Please save these in Live 12 into the given folders, keep them tiny (one or two tracks), and use
`samples/Lib1/Kick/1.wav` where a sample is needed. Then anonymize them (above). Tests for each are
written once it is here.

1. **A plug-in inside a rack, with a macro mapping** (VST2 → VST3 inside racks; today blocked as
   `rack`). New set, an Instrument Rack with Serum VST2, one Serum parameter mapped to Macro 1, the
   macro turned away from its default. Save as `projects/Rack Project/Rack VST2.als`. Then replace
   Serum VST2 by Serum VST3 inside the rack by hand, map the same parameter to Macro 1 again, and
   save as `projects/Rack Project/Rack VST3.als` (Live's own result to compare with).
2. **Tempo automation** (`set-tempo`, analysis). One set with tempo automation in the arrangement
   (e.g. 120 → 128): `projects/Tempo Project/Tempo Automated.als`; and one set at 124 BPM without
   automation: `projects/Tempo Project/Tempo 124.als`.
3. **A mastering chain on the main track** (`mastering-off`). Glue Compressor, an Audio Effect
   Rack with a Limiter inside, and a second Limiter whose on/off switch is automated:
   `projects/Mastering Project/Mastering.als`. Then switch the first two off by hand and save as
   `projects/Mastering Project/Mastering Off.als` (the expected result).
4. **The same small set from Live 9, 10 and 11** (old FileRef formats, the VST3 blocker for old
   files), only if you still have these versions: one audio clip with the Lib1 kick, saved as
   `projects/Formats Project/Live 9.als`, `Live 10.als`, `Live 11.als`.
5. **Presets with a sample** (reading and collecting presets): a Drum Rack (`.adg`) with the Lib1
   kick on one pad, a Simpler preset (`.adv`) and a clip (`.alc`), saved into `presets/`.
6. **A Max for Live device** (collecting Max devices): a set using one Max Audio Effect that you
   made yourself (so it can be shared), not yet collected: `projects/Max Project/Max.als`, with the
   `.amxd` in `devices/`.
7. **A frozen track and take lanes** (analysis ignores frozen audio and takes): one frozen MIDI
   track with a clip, one track with two takes: `projects/Frozen Project/Frozen.als`.
