# bench

Performance measurements for development; not part of the test suite. Every script only reads the
sets it is pointed at.

| Script | Measures |
|---|---|
| `scan.ts <file.als> …` | XML scanner throughput (MB/s, elements) on real sets |
| `phases.ts <folder>` | where a `doctor` run spends its time: read, gunzip, scan, reference search |
| `doctor-profile.ts <folder>` | every host call of a `doctor` run (counts and time per call type) |
| `catalog-profile.ts <catalog.sqlite> <folder> …` | the phases of a warm `livesaver index` (on a copy of the catalog) |

Run them with Bun, e.g. `bun bench/phases.ts ~/Music/Projects`.
