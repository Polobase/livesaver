---
'livesaver': minor
---

Writing from the site, said for the browser at hand.

A page on its own said that it only reads, and that fixing needs `livesaver web`. It now says
the two ways a page can fix (connected to livesaver on the computer, or editing the folder
itself) for the browser it is in: whether each works, works after a step in the browser's own
settings, or does not. **How this page can fix** on the overview opens it.

Brave is told apart from Chrome (`navigator.brave`) and gets its two steps with the addresses
to copy: the site is to be allowed under `brave://settings/content/localhostAccess` before a
page of it may reach this computer (Brave refuses without asking; the app said that it asks),
and a page edits a folder only with `brave://flags/#file-system-access-api`. Safari is told
that it does neither, Firefox that it edits no folder.

A connected page that cannot reach its livesaver says what this browser needs, and links to
livesaver's own address, which serves the same app to every browser. `livesaver web --pair`
prints the same. The link it prints can be pasted into a tab that is already open, which
connects that tab.
