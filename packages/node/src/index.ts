export {
  BATCH,
  FinderScriptComments,
  osascript,
  READ_SCRIPT,
  type ScriptResult,
  type ScriptRunner,
  SEPARATOR,
  WRITE_SCRIPT,
} from './finder.js'
export {
  createNodeHost,
  NodeFs,
  type NodeHostOptions,
  nodeCodec,
  nodeHash,
  nodeSearch,
} from './host.js'
export {
  compareVersions,
  findLiveInstalls,
  type LibraryConfig,
  type LiveInstall,
  liveIsRunning,
  type PackSlice,
  readLibraryConfig,
  readRemapTable,
  readTextLenient,
} from './live.js'
export {
  type AudioUnitsOptions,
  type InstalledPluginsOptions,
  LIVE_DATABASE,
  loadInstalledPlugins,
  PLUGIN_ROOTS,
  queryLiveDatabase,
  readLivePluginDatabase,
  readPluginCatalog,
  registeredAudioUnits,
  runAuval,
  SYSTEM_COMPONENTS,
  withLiveDatabase,
} from './live-plugins.js'
export { openDatabase, openReadonly, type ReadonlyDb } from './sqlite.js'
export {
  createWorkerParser,
  defaultWorkerCount,
  type WorkerParserOptions,
} from './worker-parser.js'
export { NodeFsWrite, type NodeFsWriteOptions } from './write.js'
export { createXattr } from './xattr.js'
