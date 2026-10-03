# Questions and answers

Short answers to what comes up first. If yours is not here, [ask on GitHub](https://github.com/Polobase/livesaver/issues).

## About livesaver

**Does livesaver need Ableton Live?**
No. It reads and writes Live's files itself. Live has to be closed while livesaver fixes, so that no open set is overwritten.

**Which versions of Live does it understand?**
Sets, racks, presets and clips (`.als`, `.adg`, `.adv`, `.alc`, `.agr`) from Live 8.2 to Live 12.

**Does it run on Windows?**
Not yet. livesaver is built and tested for macOS. It reads sets that were saved on Windows.

**What does it cost?**
Nothing. It is open source under the MIT license, and not affiliated with Ableton.

## Samples

**Live says “Media files are missing”, but the files are on my disk. Why?**
A set remembers where each sample was. If the file was moved, a drive was renamed, or the project came from another computer, Live looks in the old place. livesaver finds the file by its fingerprint wherever it is now, and puts it into the project, where Live always finds it.

**What is an uncertain match?**
A file that fits by its name and place, but whose fingerprint does not confirm it. livesaver marks such matches, and you can leave them out of a fix. See [Uncertain matches](samples.md#uncertain-matches).

**Why is a sample “Different content”?**
A file of that name was found, but its audio is not what the set used. Taking it would change your music without telling you, so it stays missing.

**Does a fix change how my set sounds?**
No. A fix changes where the set looks for its samples, not the samples and not the set's content.

**Why does my project get bigger?**
A fix copies samples from outside into the project, as *Collect All and Save* does. On the same disk, macOS can make such a copy without using more room, and livesaver copies that way where it can.

## The app

**Is anything sent anywhere?**
No. See [Your data](safety.md#your-data).

**My browser asks whether to upload my folder.**
That is the browser's word for letting a page read a folder. Nothing is uploaded. See [In the browser](browser.md#giving-it-folders).

**The app says “livesaver on this computer does not answer”.**
The `livesaver web` in your terminal was stopped. Start it again; it opens the app anew.

**Can I undo a fix after I closed the app?**
Yes. The overview offers to undo the last fix, and the [History](history.md) lists every run.

**macOS asks whether livesaver may access a folder.**
Allow it for the folders your projects and samples are in. A folder livesaver may not read is reported, and what is in it is not found.

## Removing it

**How do I remove everything livesaver wrote?**
Its own files are in `~/Library/Application Support/livesaver` (runs, with the originals for undo) and `~/.config/livesaver` (your settings). In your projects it leaves what Live would leave as well: the collected samples in `Samples/Imported`, and backups in `Backup`.
