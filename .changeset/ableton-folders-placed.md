---
'@livesaver/web': minor
'livesaver': patch
---

A page works out where Ableton's own folders lie, instead of asking for their paths.

A fix in the page refused with "It is not known where a folder lies on your disk" until the
paths of the Live app's folder and of `Music/Ableton` were typed. Both are now placed by the
paths the sets store for files in them, as project folders are: the Live app (or its
`Contents`, `App-Resources` or Core Library folder), the User Library, the Factory Packs, or
the folder that holds those two. The sets of the newest Live decide. The review of a fix shows
these places beside those of the project folders.

A path that is typed for a folder of the Live app may be any path into the app
(`/Applications/Ableton Live 12 Suite.app`, or its `Contents`, `App-Resources` or Core Library
folder): the folder is placed at its own path in that app (`liveFolderPath`).
