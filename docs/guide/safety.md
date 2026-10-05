# How your work is kept safe

livesaver edits the files your music lives in. These are the rules it keeps, so that nothing is lost.

## Before anything is written

- **Nothing is written without your yes.** On the command line every command only plans unless you pass `--apply`. In the app, every fix and every upgrade is reviewed first: what will change, and whether everything is ready.
- **Never while Live runs.** A set that is open in Live must not be rewritten under it. livesaver checks, and refuses.
- **One run at a time.** While one run writes, a second one is refused.
- **Enough room.** The copies have to fit on the disk your projects lie on.

## When a set is written

- **Only the bytes that must change do change.** livesaver never reads a set into a model and writes it out again. It replaces the bytes of a reference, and everything else stays exactly as Live saved it.
- **The result is checked before it replaces the set.** It has to be well-formed, with as many references and devices as before, and every changed reference has to lead to its file.
- **A backup beside every set.** The set as it was goes to the project's `Backup` folder, named with date and time, as Live names its own backups.
- **The original is kept as well**, in livesaver's own folder. Live keeps only its newest backups; an undo works after Live has thinned them out.
- **Written in one step.** The new set is written beside the old one and then takes its place, so there is never a half-written set. Finder tags and comments stay.
- **Dated as what it is.** A set that was rewritten carries the date of the fix, as a set does that you save in Live. Its backup keeps the date the set had, and an undo gives the set that date back.
- **A set that changed in the meantime is left alone.** Between planning and writing, the set must still be the one that was planned for.

## Afterwards

- **Every step is in a journal**, written before the step is taken. If a run is interrupted, the journal says how far it got, and an undo takes back what it did.
- **Every run can be undone**: see [History and undo](history.md).
- **Nothing is ever deleted.** What an undo removes is moved to the Trash (on Windows: to a [trash folder of livesaver's own](windows.md#on-your-computer)).

## Your data

- **Nothing leaves your computer.** livesaver has no account, no statistics, no network requests. The app asks nothing from any server but the livesaver on your own computer.
- **Only its own page may ask.** `livesaver web` listens on your computer only, and answers only the page it served itself: another site open in your browser can neither read nor change anything.

## How this is tested

Against sets that Live itself saved, and read-only against a real library: 13,000 Live documents were read and written back without a change, byte for byte. See [How it is tested](../verification.md).
