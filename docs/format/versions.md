# `<Ableton>` root attributes per Live version

The root is `<Ableton MajorVersion MinorVersion SchemaChangeCount Creator Revision>`. `Creator` is `"Ableton Live x.y.z"`.

| Creator | MajorVersion | MinorVersion | SchemaChangeCount | FileRef format |
|---|---|---|---|---|
| 8.2.x–8.4.2 | 4 | 8.1_226 | 10 | old |
| 9.0.1 / 9.1.7 | 4 | 9.0_305 | 3 / 10 | old (no Ids) |
| 9.6–9.6.2 | 4 | 9.5_326 | 2 / 7 | old (no Ids) |
| 9.7.x | 4 | 9.5_327 | absent | old (no Ids) |
| 10.0.1 / 10.0.6 | 5 | 10.0_370 | 2 / 11 | old + Ids |
| 10.1–10.1.43 | 5 | 10.0_377 | 2–6 | old + Ids |
| 11.0 / 11.0.12 | 5 | 11.0_433 / 11.0_436 | absent / 6 | new |
| 11.2.10 | 5 | 11.0_11202 | 17 | new |
| 11.3.x | 5 | 11.0_11300 | 3–7 | new |
| 12.0 | 5 | 12.0_12049 | 7 | new |
| 12.2.5 / 12.2.6 | 5 | 12.0_12203 | 3 | new |
| 12.3.x | 5 | 12.0_12300 | 1 | new |
| 12.4.x | 5 | 12.0_12402 | 5 | new + `SourceHint` |

## Consequences
- An older Live refuses files with a newer MinorVersion or SchemaChangeCount.
- **`Vst3PluginInfo` needs MinorVersion ≥ `10.0_377`.**
  - Live 12 rejects a VST3 device in `10.0_370` files as "Unknown class 'Vst3PluginInfo' … corrupt".
  - Seen in Live's `Log.txt` on 2026-09-30; livesaver blocks this (blocker `old_format`).
- Live 12.1+ forces "save under a new name" for Sets created by older versions.
- The MinorVersions in one real library: 350 × Live 9, 72 × 10.0, 279 × 10.1, 160 × 11, 56 × 12 (917 sets, 2026-09-30).
