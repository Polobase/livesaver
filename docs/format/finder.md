# Finder tags, comments and plug-in bundles (macOS)

What `status`, `reorg` and the plug-in inventory read and write outside Live's own files.

## Tags
- Stored in the extended attribute `com.apple.metadata:_kMDItemUserTags` of a file or folder.
- The value is a **binary property list**: an array of strings `"Name\n<colour>"`.
  - Colours: 0 none, 1 grey, 2 green, 3 purple, 4 blue, 5 yellow, 6 red, 7 orange.
  - Finder may write a tag without `\n<colour>` ("Continue"); that is colour 0.
  - Names may be stored decomposed (`o` + U+0308); compare them in NFC.
- No tags: the attribute is removed (an empty array works too, but Finder removes it).
- Tags are read and written directly (`getxattr`/`setxattr`); Finder notices within seconds.
- livesaver writes the same bytes as Python's `plistlib.dumps(…, fmt=FMT_BINARY)`: equal strings
  are stored once, keys sorted, the smallest offset and reference sizes.
- Copies: `cp -c`/`clonefile` carry extended attributes along; `copyfile(COPYFILE_DATA)` (Bun's and
  Node's `copyFile`) does not. livesaver removes tags and comment from every backup it writes, so a
  search by tag finds the set, not its backups.

## Comments
- Finder shows a comment from the **`.DS_Store` of the parent folder**, keyed by name. It can only
  be set through Finder itself (AppleScript `set comment of … to …`); the first call makes macOS ask
  whether the terminal may control Finder (error -1743 until allowed).
- Finder mirrors the comment into `com.apple.metadata:kMDItemFinderComment` (a binary plist string).
  That copy is readable without Finder, may lag behind, and moves with the file; a folder renamed
  outside Finder keeps the attribute but Finder no longer shows the comment, so `reorg` reads the
  comments before moving and sets them again afterwards.
- livesaver's automatic comment and the user's notes are separated by ` ‖ `; text without `‖` that
  does not start like an automatic comment counts as the user's note and is kept.

## Plug-in bundles
- `Contents/Info.plist` (XML or binary): `CFBundleExecutable`, and `AudioComponents` (array of
  dicts with `type`, `subtype`, `manufacturer`, `name`) for Audio Units.
- The executable in `Contents/MacOS` tells native from Rosetta: Mach-O magic `CAFEBABE` (universal;
  20-byte entries; `CAFEBABF` 32-byte), then the CPU types (`0x0100000C` arm64, `0x01000007`
  x86_64). Java class files share `CAFEBABE`; their "count" is ≥ 20.
- VST3 bundles list class ids in `Contents/Resources/moduleinfo.json` (JSON5: trailing commas).
- Unscanned VST2 bundles of JUCE/Arturia plug-ins: the VST2 id equals the AU subtype of the
  same-named `.component`.

## Live's plug-in database
`~/Library/Application Support/Ableton/Live Database/Live-plugins-*.db` (SQLite, WAL mode, kept
open by Live: read a copy together with `-wal`/`-shm`):
- `plugin_modules(module_id, path, arch, processor, scanstate, …)`: every bundle, once per
  processor Live ran on (2 Apple Silicon, 1 Intel/Rosetta); `scanstate` 1 = loaded.
- `plugins(module_id, dev_identifier, name, enabled, …)`: `device:vst:<kind>:<id>?n=<name>`,
  `device:vst3:<kind>:<uuid>`, `device:au:<kind>:<manufacturer>:<subtype>:<type>` (numbers).
- A plug-in that only has Intel rows loads only when Live runs under Rosetta.
