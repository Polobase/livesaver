---
'@livesaver/web': minor
'livesaver': minor
---

The web app on its own keeps its folders across a reload, as far as a browser lets a page.

The lists come back with the paths that were typed, the ticks, and how a scan matches. A
folder itself comes back where the browser handed out a handle for it: one chosen for editing,
and one that was dropped (Chrome, Edge, Brave), after the browser's OK. A folder that was
chosen with the dialog, or dropped in Safari or Firefox, waits as a row to be added again, and
takes its settings back.

`foldersFromDrop` takes the handle of a dropped folder along where a browser offers one
(`kept` on a listing source), without waiting for one that does not come. `hiddenByHandle` and
`lostBehindHandle` say which names a handle hides and how many files of a listing that costs: a
dropped folder is read again through its handle only if that loses none.

No handle is kept in a private window: Chromium takes a handle there and then answers nothing
about folders any more.
