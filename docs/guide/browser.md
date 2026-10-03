# In the browser

The app also runs on its own, as a page in your browser. It reads the folders you give it and changes nothing: good for a first look, or on a computer where you cannot install anything.

![The app in a browser on its own: it scans and shows everything, and says what needs livesaver](images/browser-light.webp)

## What a page can do

| | In the browser | With livesaver on your Mac |
|---|---|---|
| Scan samples: what is missing, what a fix would do | yes | yes |
| Missing samples by where they came from, with advice | yes | yes |
| The plug-ins your sets use | yes | yes |
| Whether those plug-ins are installed | no: a page cannot see that | yes |
| Download the reports | yes | yes |
| Fix, upgrade, undo, history | no | yes |

What the page cannot do is said where you would look for it, with how to get it.

## Giving it folders

Choose a folder with **Add folder**, or drop it on the page. Your browser may ask whether to “upload” the folder: that is its word for letting a page read it. Nothing is uploaded; the files stay where they are and are read there.

Worth adding as sample folders:

- **`Music/Ableton`** in your home folder: your User Library and the Factory Packs.
- **The Ableton Live app**, dropped on the page from your Applications folder. To a drop, an app is a folder; it holds the Core Library, and Live's own list of content that moved between versions.
- **`/Users/Shared`**, if you have libraries from Native Instruments.

Until Live's own content is there, the page says that samples of the Core Library cannot be found.

## Where a folder lies

A browser does not tell a page where a folder lies on your disk, but sets refer to their samples by where they lie. livesaver works it out for your project folders from the sets themselves. For another folder you can type its path (**Set path**), which makes the result the same as on the command line.

## Why a page cannot fix

Writing needs an access that only some browsers give, and that hides files with certain names from the page: a page could then call samples missing that are there. A page can also not see whether Live is running, and could keep no journal for an undo. So the page only reads, and fixing is livesaver's job: see [Getting started](getting-started.md#install-livesaver-on-your-mac).

## Nothing leaves your computer

The page asks no server for anything once it is loaded: no fonts, no icons, no statistics. You can check that in your browser's developer tools, and it is tested with every change to the app. See [How the web app works](../web.md).
