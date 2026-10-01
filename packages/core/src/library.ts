/** Small parsers for files found around Live content (pack info, Max device headers). */

/** Device type code from the first 12 bytes of an `.amxd` (`ampf` + 4 bytes + code), or undefined. */
export function amxdTypeCode(head: Uint8Array): string | undefined {
  if (head.length < 12) return undefined
  if (head[0] !== 0x61 || head[1] !== 0x6d || head[2] !== 0x70 || head[3] !== 0x66) return undefined
  return String.fromCharCode(
    head[8] as number,
    head[9] as number,
    head[10] as number,
    head[11] as number,
  )
}

export interface PackProperties {
  /** `PackDisplayName`, e.g. "Drum Essentials". */
  readonly name: string | undefined
  /** `PackUniqueID`, e.g. "www.ableton.com/249". */
  readonly id: string | undefined
}

/** Read `<pack>/Ableton Folder Info/Properties.cfg` text (starts with a short binary header). */
export function parsePackProperties(text: string): PackProperties {
  return {
    name: /String PackDisplayName = "([^"]*)"/.exec(text)?.[1],
    id: /String PackUniqueID = "([^"]*)"/.exec(text)?.[1],
  }
}
