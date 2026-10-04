---
'livesaver': patch
---

The web app on its own says when a scan did not read folders of the last visit.

After a reload a browser hands a page only the folders it kept (one that was dropped, or chosen
for editing); a folder chosen in the dialog is a row that waits to be added again. A scan made
in between read the project folder alone and listed the samples of every other folder as "not
found", without a word. Now the page says which folders are not there before a scan, and after
a scan made without them on every page and beside the samples that were not found; the same
for a folder the browser kept and wants to be asked for. A row that waits, and the hint at
"Add folder", say that a dropped folder is kept for the next visit.
