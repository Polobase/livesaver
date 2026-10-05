/**
 * What differs by the computer a page runs on: where Ableton keeps its folders, what the file
 * manager is called, how a hidden folder is reached. livesaver is made and tested on a Mac;
 * what is said for Windows is as Ableton documents it, and as sets saved on Windows name it.
 */
import { onWindows } from '@livesaver/web'

export interface Platform {
  readonly windows: boolean
  /** Finder, or File Explorer. */
  readonly fileManager: string
  /** The folder with the User Library and the Factory Packs, and where it is. */
  readonly libraries: { readonly folder: string; readonly where: string }
  /** How Live's own content is added, in one sentence. */
  readonly liveContent: string
  /** What the guide to that says first. */
  readonly liveGuide: string
  /** An example of a path into Live's own folder, and of a folder of the user's. */
  readonly livePath: string
  readonly folderPath: string
  /** Where vendors install libraries (Native Instruments). */
  readonly vendorFolder: string
  /** Where the VST plug-ins and Live's plug-in database lie. */
  readonly pluginFolder: string
  readonly database: { readonly folder: string; readonly where: string }
  /** How a folder that the dialog does not show is reached in it. */
  readonly hiddenInDialog: string
  /** A set a browser writes loses what Finder keeps with a file: a thing of the Mac only. */
  readonly finderTags: boolean
  /**
   * The names a browser hides in a folder it lets a page edit, as its user knows them. (On
   * Windows no file has a name with the other signs a browser minds.)
   */
  readonly hiddenNames: string
}

export function platformOf(windows: boolean): Platform {
  return windows
    ? {
        windows,
        fileManager: 'File Explorer',
        libraries: { folder: 'Documents\\Ableton', where: 'in your user folder' },
        liveContent:
          'add the folder “Resources” of Live, which lies in C:\\ProgramData\\Ableton\\Live 12 Suite.',
        liveGuide:
          'The samples of Live’s Core Library lie in a folder of Live’s own, which Windows hides. Three steps bring them to this page.',
        livePath: 'C:\\ProgramData\\Ableton\\Live 12 Suite',
        folderPath: 'C:\\Users\\you\\Music',
        vendorFolder: 'C:\\Users\\Public\\Documents',
        pluginFolder: 'C:\\Program Files\\Common Files\\VST3',
        database: {
          folder: 'AppData\\Local\\Ableton\\Live Database',
          where: 'in your user folder',
        },
        hiddenInDialog: 'type its path into the address bar of the dialog',
        finderTags: false,
        hiddenNames: 'a space at its start',
      }
    : {
        windows,
        fileManager: 'Finder',
        libraries: { folder: 'Music/Ableton', where: 'in your home folder' },
        liveContent: 'drag the Ableton Live app here from your Applications folder.',
        liveGuide:
          'The samples of Live’s Core Library lie inside the Ableton Live app. Three steps bring them to this page.',
        livePath: '/Applications/Ableton Live 12 Suite.app',
        folderPath: '/Users/you/Music',
        vendorFolder: '/Users/Shared',
        pluginFolder: '/Library/Audio/Plug-Ins',
        database: {
          folder: 'Library/Application Support/Ableton/Live Database',
          where: 'in your home folder',
        },
        hiddenInDialog: 'press ⌘⇧G and type the path',
        finderTags: true,
        hiddenNames: 'a “/” as Finder shows it, or a space at its start or end',
      }
}

/** The computer this page runs on. */
export const platform: Platform = platformOf(onWindows())
