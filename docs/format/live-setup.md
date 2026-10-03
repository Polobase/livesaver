# Live installation and library locations (macOS)

Where Live keeps its app resources, its library folders and its own databases on a Mac, and how livesaver finds them without being told.

## App
- `/Applications/Ableton Live <n> <Edition>.app`
  - version in `Contents/Info.plist` → `CFBundleShortVersionString`, e.g. `12.4.6 (2026-09-10_0de5c8fa9a)`
  - bundle id `com.ableton.live`
- `Contents/App-Resources/`:
  - `Core Library/`: a pack with id `www.ableton.com/0`
  - `Builtin/`: RelativePathType 7
  - `Database/filerefmap.db`: SQLite, read-only
- With several Live apps installed, livesaver takes the one with the highest version in its `Info.plist` (the name is not reliable).

## `filerefmap.db` (Live's remap table for moved library files)
- `sample_mapping(src_type, src_packid, src_ref, dst_type, dst_packid, dst_ref)`
  - 37,617 rows in 12.4.6: type 2→5 (35,610), 5→5 (1,973), 5→7 (32), 7→7 (2)
- `pack_names(packid, packname)`: 81 rows
- `meta_info`
- **Lookup:** by `(type, packid or '', norm(ref))`; chains are followed for up to 5 steps.
- **Destination:**
  - type 7 → `Builtin/dst`
  - type 5 + Core Library → `Core Library/dst`
  - type 5 + known pack → `Factory Packs/<pack_names[id]>/dst`

## Preferences: `~/Library/Preferences/Ableton/Live <x.y.z>/`
- `Library.cfg` (XML):
  ```xml
  <ContentLibrary>
    <UserLibrary><LibraryProject Id="0"><ProjectLocation /><ProjectName Value="User Library" />
      <ProjectPath Value="/Users/you/Music/Ableton" /></LibraryProject></UserLibrary>
    <SliceInfoList>
      <LibrarySliceInfo Id="10576" Path="/Users/you/Music/Ableton/Factory Packs/Drum Essentials"
                        DisplayName="Drum Essentials" UniqueId="www.ableton.com/249" />
    </SliceInfoList>
    <UserFolderInfoList /><PreferredFactoryPacksInstallationPath Value="" />
  ```
  So the User Library is `ProjectPath + '/' + ProjectName`, and each pack's location comes by id from `SliceInfoList`. Oddity: `UniqueId="www.ableton.com/M4L Big Three"`.
- `Preferences.cfg`: binary, magic `AB 1E 56 78`.
- `Log.txt`: check it after opening changed Sets, for "corrupt" and "Unknown class".
- `Options.txt`: `-_RelaxFileManagerSearch`.
- `PluginScanner.txt`, `Indexer.txt`, `Crash/`.

## Packs
`<pack>/Ableton Folder Info/Properties.cfg`:
- starts with `Ableton#04I`, then text
- `String PackUniqueID = "www.ableton.com/249";` and `String PackDisplayName = "Drum Essentials";`
- also ProductId, PackMajorVersion, …

livesaver reads these two values with simple patterns and falls back to the folder name.

## Live's databases: `~/Library/Application Support/Ableton/Live Database/`
- `Live-plugins-1.db` (Live 12.1+):
  - `plugins(plugin_id, module_id, dev_identifier, name, vendor, version, sdk_version, flags, scanstate, subcategories, enabled)`
  - `plugin_modules(module_id, path, arch 2=VST2/3=VST3, processor 1=Intel|2=Apple Silicon, scanstate, fingerprint)`; `fingerprint = hex(exe size):hex(mtime)`
  - `plugin_domains`, `version`
  - **No AU rows.**
- `Live-files-<n>.db` (browser index, e.g. `Live-files-12300.db`):
  - `files(file_id, name, parent_id, file_type FourCC, file_size, mod_date)` plus `places` and an FTS index; no CRC
  - paths come from a recursive CTE over `parent_id`
- **Safe reading:**
  - The databases are in WAL mode. Opening one plainly read-only failed, and `?mode=ro&immutable=1` can return a stale snapshot after a crash.
  - livesaver **copies `.db` plus `-wal`/`-shm` to a temp folder** and opens the copy.

## Other roots
- `~/Music/Ableton/User Library` and `~/Music/Ableton/Factory Packs`: Live's defaults (livesaver reads the real ones from `Library.cfg`)
- `/Users/Shared`: Native Instruments content from Native Access (a vendor library: files re-saved by the vendor match by size and CRC as described in fingerprints.md)
- preferred roots for tie-breaks (configurable, e.g. your own sample folder first)
