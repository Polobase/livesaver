/**
 * Incremental SHA-1 in pure TypeScript, for runtime-agnostic code and for hosts without a native
 * incremental hash (a browser's `crypto.subtle` only hashes a whole buffer, asynchronously).
 * Blocks are hashed straight from the input, without copying, so whole samples go through fast.
 */
export class Sha1 {
  private h0 = 0x67452301
  private h1 = 0xefcdab89 | 0
  private h2 = 0x98badcfe | 0
  private h3 = 0x10325476
  private h4 = 0xc3d2e1f0 | 0
  /** Bytes that do not fill a block yet. */
  private readonly block = new Uint8Array(64)
  private readonly w = new Int32Array(80)
  private used = 0
  private length = 0

  update(data: Uint8Array | string): this {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const n = bytes.length
    this.length += n
    let i = 0
    if (this.used > 0) {
      const take = Math.min(64 - this.used, n)
      for (; i < take; i++) this.block[this.used + i] = bytes[i] as number
      this.used += take
      if (this.used < 64) return this
      this.compress(this.block, 0)
      this.used = 0
    }
    for (; i + 64 <= n; i += 64) this.compress(bytes, i)
    for (; i < n; i++) this.block[this.used++] = bytes[i] as number
    return this
  }

  hex(): string {
    const bits = BigInt(this.length) * 8n
    const padding = new Uint8Array((this.used < 56 ? 56 : 120) - this.used + 8)
    padding[0] = 0x80
    new DataView(padding.buffer).setBigUint64(padding.length - 8, bits, false)
    this.update(padding)
    return [this.h0, this.h1, this.h2, this.h3, this.h4]
      .map((v) => (v >>> 0).toString(16).padStart(8, '0'))
      .join('')
  }

  /** One 64-byte block of `b`, starting at `o`. */
  private compress(b: Uint8Array, o: number): void {
    const w = this.w
    for (let t = 0; t < 16; t++, o += 4) {
      w[t] =
        ((b[o] as number) << 24) |
        ((b[o + 1] as number) << 16) |
        ((b[o + 2] as number) << 8) |
        (b[o + 3] as number)
    }
    for (let t = 16; t < 80; t++) {
      const x =
        (w[t - 3] as number) ^ (w[t - 8] as number) ^ (w[t - 14] as number) ^ (w[t - 16] as number)
      w[t] = (x << 1) | (x >>> 31)
    }
    let a = this.h0
    let bb = this.h1
    let c = this.h2
    let d = this.h3
    let e = this.h4
    let temp: number
    // The four rounds as four loops: no branch per step.
    for (let t = 0; t < 20; t++) {
      temp =
        (((a << 5) | (a >>> 27)) + ((bb & c) | (~bb & d)) + e + 0x5a827999 + (w[t] as number)) | 0
      e = d
      d = c
      c = (bb << 30) | (bb >>> 2)
      bb = a
      a = temp
    }
    for (let t = 20; t < 40; t++) {
      temp = (((a << 5) | (a >>> 27)) + (bb ^ c ^ d) + e + 0x6ed9eba1 + (w[t] as number)) | 0
      e = d
      d = c
      c = (bb << 30) | (bb >>> 2)
      bb = a
      a = temp
    }
    for (let t = 40; t < 60; t++) {
      temp =
        (((a << 5) | (a >>> 27)) +
          ((bb & c) | (bb & d) | (c & d)) +
          e -
          0x70e44324 +
          (w[t] as number)) |
        0
      e = d
      d = c
      c = (bb << 30) | (bb >>> 2)
      bb = a
      a = temp
    }
    for (let t = 60; t < 80; t++) {
      temp = (((a << 5) | (a >>> 27)) + (bb ^ c ^ d) + e - 0x359d3e2a + (w[t] as number)) | 0
      e = d
      d = c
      c = (bb << 30) | (bb >>> 2)
      bb = a
      a = temp
    }
    this.h0 = (this.h0 + a) | 0
    this.h1 = (this.h1 + bb) | 0
    this.h2 = (this.h2 + c) | 0
    this.h3 = (this.h3 + d) | 0
    this.h4 = (this.h4 + e) | 0
  }
}
