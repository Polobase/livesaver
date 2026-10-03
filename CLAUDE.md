# livesaver: working rules

livesaver is a TypeScript toolkit for Ableton Live *files*: it parses and patches `.als/.adg/.adv/.alc`, relinks samples, batch-runs Collect All and Save, converts VST2 to VST3, manages projects (Finder status, rating sheet, reorg, move), audits plug-ins, catalogs and searches a library, and runs codemods. It is a Bun-workspace monorepo that runs on Node.js now and in the browser later. Personal notes (the plan, the user's library) are in `CLAUDE.local.md`, which git ignores.

## Commands
- `bun install`: install everything
- `bun run build`: `tsc` builds every package in dependency order (`scripts/build.ts`)
- `bun test`: all tests. `LIVESAVER_CORPUS=<folder> bun test corpus` runs the read-only corpus round trip.
- `bun run check`: Biome plus a typecheck of every package (run `build` first)
- `bun run test:node`: the built CLI under Node.js (after `build`)
- `bun run web`: the web app on `http://127.0.0.1:5173/` as `livesaver web` serves it, so it can also fix (rebuilt when the page is reloaded after a change)
- `bun run test:web`: the web app in a real, headless Chromium-based browser (`LIVESAVER_BROWSER` = its executable if none is found)
- `bench/`: performance measurements only (see `bench/README.md`)
- CLI tests outside the real library: set `LIVESAVER_HOME` (run folders) and `LIVESAVER_TRASH_DIR` (undo's Trash).

## Packages
| Package | Role | Runtime |
|---|---|---|
| `@livesaver/xml` | byte-level XML scanner, element index, byte-exact patcher | anywhere |
| `@livesaver/core` | Ableton formats, FileRefs, paths, CRC, analysis, plist/CSV/Mach-O, Finder tags, Host ports | anywhere |
| `@livesaver/plugins` | plug-in identity and inventory, VST2→VST3 conversion | anywhere |
| `@livesaver/ops` | resolve/match, doctor, collect, status, reorg, move, audit, codemods, journal/undo, reports | anywhere |
| `@livesaver/catalog` | SQLite catalog of sets, incremental index, the `find` language | anywhere |
| `@livesaver/node` | Node/Bun host: fs, gzip, workers, xattr, Finder comments, SQLite, Live setup and plug-in database | Node/Bun |
| `@livesaver/web` | browser host: uploaded/dropped/picked folders as a read-only file system, gzip, hash, worker-based parsing | browser |
| `livesaver` (packages/cli) | the CLI; `livesaver web` serves the web app and checks, fixes and undoes for it (`src/web/`) | Node/Bun |
| `livesaver-web` (apps/web) | the web app: Preact page; with livesaver behind it it can fix, on its own it checks in workers, read-only (private) | browser |
| `@livesaver/test-kit` | fixture builders (private) | tests |

## Hard rules
1. **Ableton Extensions are out of scope.** Never look at `../cloned-extensions`, `../my-extensions` or `../ignore`.
2. **Never write to the real library from tests.** Tests work in temp dirs only. Corpus tests are read-only.
3. **Never run `--apply` against a real library** (the user's projects, see `CLAUDE.local.md`, or `~/Music/Ableton`) **without the user's explicit OK** in the current conversation. This includes `status --apply` (Finder tags, comments, the rating sheet), `reorg run --apply`, `move run/sets --apply`, `run <codemod> --apply`, and Fix or Undo in the web app (its `/api/fix` and `/api/undo`): try those on temporary copies only.
4. **The repo is self-contained and public.** No references to private tools, scripts or folders outside the repo, and no personal data: no user names, home folders, or project and song names from a real library in code, tests, docs or fixtures. Tests use `fixtures/` (sets saved by Live, anonymized with `scripts/anonymize-fixture.ts`) and the builders in `@livesaver/test-kit`. When a case needs a set only Live can produce, ask the user to save one and add it to `fixtures/` (see the wanted list in `fixtures/README.md`).
5. **Runtime-agnostic packages** (xml, core, plugins, ops, catalog; also `@livesaver/web` and the web app's `src`, which may use browser APIs):
   - no `node:*`/`bun` imports and no `Buffer`/`process`/`Bun` (Biome enforces this)
   - `Uint8Array` in public APIs
   - I/O only through the Host ports in `@livesaver/core`
6. **GPL projects** (abletoolz, DawVert): use facts only, never copy code.
7. **Byte-exactness:** untouched bytes of a Live file must never change. Every edit goes through `@livesaver/xml`'s patcher.
8. **Style:** Biome (2 spaces, width 100, single quotes, no semicolons); files under 500 lines; comments explain *why*.
9. **English only**, everywhere: code, comments, docs, CLI output, reports, default tag names, file names and test data. No second language and no `--lang` option; users rename tags, decisions and stars in their config file.

## Where knowledge lives
- `docs/format/`: file-format facts (FileRef formats, RelativePathType, CRC, versions, plug-ins, Finder metadata, Live's databases)
- `docs/verification.md`: what is tested and measured, and how
- `docs/codemods.md`: writing codemods
- `docs/web.md`: how the web app works, what a browser can and cannot see, and how it is tested
- `fixtures/`: projects and samples saved by Live, what each one covers, and the fixtures still wanted
