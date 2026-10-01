export { hashBytes, NameTable } from './names.js'
export { type Edit, Patch, PatchConflictError, type PatchOptions, patch } from './patch.js'
export { indexOfBytes, type ScanOptions, scan, Tables, XmlSyntaxError } from './scan.js'
export {
  decodeEntities,
  decodeUtf8,
  decodeValue,
  encodeUtf8,
  escapeAttr,
  escapeText,
  type Quoting,
  quoteAttr,
} from './text.js'
export { type El, type Span, XmlIndex } from './xml-index.js'
