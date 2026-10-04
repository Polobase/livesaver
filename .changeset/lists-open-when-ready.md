---
'livesaver': patch
---

The web app on its own takes no folder before it knows the folders of the last visit.

Reading them back takes a browser a moment. A folder added in that moment was replaced by the
folders that came back, and the list noted for the next visit held it alone: the others were
lost. The lists are closed until the page knows what it starts with, nothing is noted before,
and a browser that hands a page no handle (Firefox, Safari) is not kept waiting for its
database.
