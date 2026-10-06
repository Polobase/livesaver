# livesaver on Windows

livesaver is made and tested on a Mac. Windows is new: it is built from what Ableton documents about Live on Windows and from the way sets that were saved on Windows store their files. **No one has tried it on a Windows computer with Live yet.** This page says what is there, what differs from a Mac, and what is not known.

So try a fix on a copy of a project first. A fix keeps a backup of every set it rewrites and can be undone, on Windows as on a Mac; and a scan changes nothing anywhere.

## What is the same

Scan, review, fix, undo, the history and the reports, in the browser and with `livesaver web`: everything in this guide applies. Where a page of the guide says "your Mac", read "your computer"; where it differs on Windows, it is said here.

## Where things are

| | On a Mac | On Windows |
|---|---|---|
| Your User Library and the Factory Packs | `Music/Ableton` in your home folder | `Documents\Ableton` in your user folder |
| Live's own content (the Core Library) | inside the Ableton Live app | `C:\ProgramData\Ableton\Live 12 Suite\Resources` |
| Libraries of Native Instruments | `/Users/Shared` | `C:\Users\Public\Documents` |
| Live's plug-in database | `Library/Application Support/Ableton/Live Database` in your home folder | `AppData\Local\Ableton\Live Database` in your user folder |
| Live's settings, which say where your library is | `Library/Preferences/Ableton/Live 12.x` | `AppData\Roaming\Ableton\Live 12.x\Preferences` |
| What livesaver keeps (runs, originals for the undo) | `Library/Application Support/livesaver` | `AppData\Local\livesaver` |
| What an undo takes out of a project | the Trash | `AppData\Local\livesaver\Trash` |
| Your settings for livesaver | `.config/livesaver/config.json` in your home folder | the same, in your user folder |

`ProgramData` and `AppData` are hidden folders. In File Explorer and in a folder dialog, type the path into the address bar.

If your folders are elsewhere (a library on another drive), livesaver on your computer reads that from Live's settings, and you can name any folder yourself: see [The command line](command-line.md#settings).

## Paths

A set names a file on Windows by its path with a drive. Live 9 and 10 wrote it with `\` (`C:\Users\you\Music\kick.wav`); into a set of today's format Live writes it with `/` (`C:/Users/you/Music/kick.wav`). livesaver reads both, shows paths with `/`, and writes them that way.

A path of the other system is no file: on Windows, a set from a Mac that names `/Users/you/Music/kick.wav` misses that sample until it is found again by its name and fingerprint, and the other way round.

## In the browser

The page sees that it runs on Windows, and names the folders above where it asks for them.

- **Live's own content.** In File Explorer, type `C:\ProgramData\Ableton` into the address bar and open the folder of your Live. Drag its `Resources` folder onto the sample folders. The page shows these steps under **Show me how**. Only the Core Library in it is read.
- **Your browser may say it cannot open the folder.** Chrome and Edge keep some folders of the system from a page, as they keep an app's folder on a Mac; `ProgramData` and `AppData` are likely among them. If your browser says so, press **Cancel**: the page reads the folder for this visit all the same, and you add it again next time.
- **Fixing in the page** works in Chrome and Edge, as on a Mac: see [In the browser](browser.md#fixing-in-the-page).

## On your computer

livesaver needs [Node.js](https://nodejs.org) 22.13 or newer, or [Bun](https://bun.sh). [Getting started](getting-started.md#install-livesaver) has the commands; they are the same on Windows.

- A path can be typed either way: `livesaver doctor C:\Users\you\Music\Projects` or with `/`. In the settings file write `/` (`"C:/Samples"`): a `\` has a meaning of its own there.
- **Never while Live runs.** livesaver asks Windows which programs run, and writes nothing while one of them is called like Live (`Ableton Live 12 Suite.exe`).
- **An undo** moves what a fix copied to a trash folder of livesaver's own, `AppData\Local\livesaver\Trash`, and not to the Recycle Bin. A program that sends a file to the Recycle Bin without stopping to ask you loses it where the Recycle Bin cannot take it (a file on a USB stick, or a very large one): Windows then deletes the file for good. Nothing livesaver removes may end like that. Empty the folder when you no longer need what is in it.
- **A name Windows cannot make** is never written. A set from a Mac may name a sample with a `:`, `?`, `*`, `"`, `<`, `>` or `|` in its name, or with a space or a dot at its end: such a sample is copied into the project under the name of the file that was found on your disk.

## What Windows does not have

- **Finder tags and comments.** `livesaver status` measures every set and writes its reports and the rating sheet, but marks nothing in File Explorer.
- **Rosetta.** No plug-in is "Rosetta only" on Windows.
- **Audio Units.** A set from a Mac that uses an Audio Unit misses that plug-in on Windows.
- **A look into the plug-ins themselves.** On a Mac livesaver also reads the plug-in bundles; on Windows it knows the plug-ins that Live has scanned, from Live's plug-in database. A plug-in installed since Live last ran is not known until Live has seen it.

## What is tested, and what is not

- Tested, on a Mac: the handling of Windows paths, of sets that Live 9 and 10 saved on Windows, and of Ableton's folders as Windows has them, on made-up disks with drive letters; and the app in browsers that are told they run on Windows.
- Tested, on a Windows machine, by automated tests on every change: the command line fixes sets that Live saved and takes the fix back, moves what the undo removes to its trash folder, and writes nothing while a program called like Live runs. No Live is installed on that machine.
- Not tested: livesaver with Live on a Windows computer, and the app in a browser on Windows. Where Live keeps its folders on Windows is taken from Ableton's documentation. No set that Live 11 or 12 saved on Windows was at hand: what such a set stores is known only as far as [the format notes](../format/fileref.md#windows) say.

If something does not fit your computer, please [tell us](https://github.com/Polobase/livesaver/issues): what you did, what livesaver said, and your versions of Windows and Live.
