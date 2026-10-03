# The command line

Everything the app does, the `livesaver` command does too, and more: project status in Finder, a catalog of your sets to search, and codemods. Every command only plans unless you pass `--apply`.

## Samples

```sh
# what livesaver found: Live, User Library, packs, where it searches
livesaver env

# read-only: missing and external samples, per set
livesaver doctor ~/Music/Projects

# a dry run of "Collect All and Save" for every project
livesaver collect ~/Music/Projects

# really do it (quit Live first)
livesaver collect ~/Music/Projects --apply
```

| Option | What it does |
|---|---|
| `--search <dir>` | another folder to search (may be repeated) |
| `--no-default-search` | search only the `--search` folders |
| `--ignore <dir>` | a folder that is not searched |
| `--exclude <dir>` | a folder whose sets are left alone |
| `--pack-limit <MB>` | pack files above this size stay in the pack (default 50; 0 never copies) |
| `--match-library-path` | also accept a library file with another fingerprint, as an uncertain match |
| `--certain-only` | leave uncertain matches out |
| `--report-dir <dir>` | write the reports there |
| `--json` | print the whole result as JSON |

See [Fix missing samples](samples.md).

## Plug-ins

```sh
# installed plug-ins: formats, native or Rosetta, versions
livesaver plugins list

# missing, Rosetta only, native alternatives, unused
livesaver plugins audit ~/Music/Projects

# VST2 → VST3 for verified plug-ins
livesaver plugins upgrade ~/Music/Projects [--apply]
```

See [Plug-ins](plugins.md).

## Runs and undo

```sh
# past runs, with their reports
livesaver runs

# restore the sets of a run; copies nobody uses go to the Trash
livesaver undo <run>

# the app: scan, review, fix and undo in the browser
livesaver web
```

See [History and undo](history.md).

## Search your library

`livesaver index` reads every set once into a catalog; later runs read only the sets that changed. `livesaver find` then answers at once:

```sh
livesaver index ~/Music/Projects
livesaver find plugin:serum bpm:120..128 stage:arranged missing:samples
livesaver sql "SELECT name, tempo FROM sets ORDER BY seconds DESC LIMIT 5"
```

| Term | Matches sets … |
|---|---|
| `kick` `"night drive"` | whose name, project, plug-ins, samples or locators contain the words |
| `plugin:serum` `format:vst2` | that use a plug-in (by name or id), or a plug-in format |
| `sample:snare` `device:lfo` | that use a sample or a Max device of that name |
| `stage:arranged` | at a stage: empty, session, sketch, arranged, elaborated |
| `missing:samples` `missing:plugins` `rosetta:yes` `complete:yes` | by completeness |
| `bpm:120..128` `length:>3:00` `bars:>=64` `tracks:<8` | by numbers |
| `live:12` `modified:2024` `modified:>2025-06` | by Live version or date |
| `project:studio` `path:archive` `has:locators` `duplicate:yes` | by place or features |
| `-stage:empty` | negated |

## Project status in Finder

```sh
# progress and completeness as Finder tags and comments
livesaver status ~/Music/Projects [--apply]

# sort projects into folders by their decision tag …
livesaver reorg plan ~/Music/Projects

# … after you checked the plan
livesaver reorg run <plan.csv> [--apply]

# sets saved into another song's project …
livesaver move plan ~/Music/Projects

# … move into a project of their own
livesaver move run <plan.csv> [--apply]
```

`status` measures every set (length of the arrangement, automation, missing samples and plug-ins) and marks sets and project folders in Finder with a tag for progress and a one-line comment with the facts. Your own tags and anything you write in a comment after `‖` stay untouched.

## Codemods

Change many sets at once with a few lines of TypeScript, with the same backups and undo:

```sh
livesaver run set-tempo ~/Music/Projects --option bpm=124 [--apply]
```

See [Codemods](../codemods.md).

## Settings

livesaver finds Live, your User Library and your packs by itself. What you want different goes into `~/.config/livesaver/config.json`; `livesaver init` writes one for your setup.

```json
{
  "searchRoots": ["~/Music/Ableton", "/Volumes/Samples"],
  "vendorLibraries": ["/Users/Shared"],
  "packLimitMB": 50,
  "status": { "projects": "~/Music/Projects" }
}
```

| Key | What it is |
|---|---|
| `searchRoots` | the folders searched for samples |
| `vendorLibraries` | folders with installed libraries, where a vendor's re-saved file is accepted |
| `preferredRoots` | folders that win when identical copies lie in several places |
| `packLimitMB` | pack files above this size stay in the pack |
| `userLibrary`, `factoryPacks`, `appResources` | where Ableton's own folders are, if they are not found |
| `status` | names and folders for `status` and `reorg`; `projects` is the folder the app starts with |

The app starts with these settings, and remembers the folders of its last scan. **Settings › Reset to the command line's settings** goes back to them.
