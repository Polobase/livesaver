/**
 * The few web-standard globals the runtime-agnostic packages (xml, core, ops, …) may use.
 * Their build configs have `lib: ["ES2023"]` and `types: []`, so Node's and Bun's globals
 * (Buffer, process, Bun) are not visible there; only what is declared here is.
 * Every runtime livesaver targets (Bun, Node ≥ 22, browsers) provides these.
 */

interface TextDecoderOptions {
  fatal?: boolean
  ignoreBOM?: boolean
}

interface TextDecodeOptions {
  stream?: boolean
}

interface TextDecoder {
  readonly encoding: string
  readonly fatal: boolean
  readonly ignoreBOM: boolean
  decode(input?: ArrayBufferView | ArrayBuffer, options?: TextDecodeOptions): string
}

declare var TextDecoder: {
  prototype: TextDecoder
  new (label?: string, options?: TextDecoderOptions): TextDecoder
}

interface TextEncoderEncodeIntoResult {
  read: number
  written: number
}

interface TextEncoder {
  readonly encoding: string
  encode(input?: string): Uint8Array
  encodeInto(source: string, destination: Uint8Array): TextEncoderEncodeIntoResult
}

declare var TextEncoder: {
  prototype: TextEncoder
  new (): TextEncoder
}

interface Performance {
  now(): number
}

declare var performance: Performance
