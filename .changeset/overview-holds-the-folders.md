---
'@livesaver/web': patch
'livesaver': minor
---

The web app: the folders are on the overview, and the page says how it reads them.

- After a scan the overview has the library in one line that opens into its folders and
  options, so a folder is added and the library scanned again where the result is read. A scan
  that is started in the Settings goes to the overview.
- Where folders are added, a box says that nothing is uploaded, how a page reads a folder
  through the browser's file APIs, and what the browser's questions mean.
- "Show me how" shows in pictures how the Live app's own content is added.
- A drop asks the browser for no handle when the folder is an app's (`folderOfAnApp`): Chrome,
  Edge and Brave answered that with "can't open this folder because it contains system files",
  although the folder was read all the same.
