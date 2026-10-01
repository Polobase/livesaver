/** Incremental SHA-1 in pure TypeScript (for runtime-agnostic code; hosts use native hashes for files). */
export class Sha1 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0])
  private readonly block = new Uint8Array(64)
  private readonly w = new Uint32Array(80)
  private used = 0
  private length = 0

  update(data: Uint8Array | string): this {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.length += bytes.length
    let i = 0
    while (i < bytes.length) {
      const take = Math.min(64 - this.used, bytes.length - i)
      this.block.set(bytes.subarray(i, i + take), this.used)
      this.used += take
      i += take
      if (this.used === 64) {
        this.compress()
        this.used = 0
      }
    }
    return this
  }

  hex(): string {
    const bitLength = BigInt(this.length) * 8n
    this.update(new Uint8Array([0x80]))
    while (this.used !== 56) this.update(new Uint8Array([0]))
    const tail = new Uint8Array(8)
    new DataView(tail.buffer).setBigUint64(0, bitLength, false)
    this.update(tail)
    return [...this.h].map((v) => v.toString(16).padStart(8, '0')).join('')
  }

  private compress(): void {
    const w = this.w
    const b = this.block
    for (let t = 0; t < 16; t++) {
      w[t] =
        ((b[4 * t] as number) << 24) |
        ((b[4 * t + 1] as number) << 16) |
        ((b[4 * t + 2] as number) << 8) |
        (b[4 * t + 3] as number)
    }
    for (let t = 16; t < 80; t++) {
      const x =
        (w[t - 3] as number) ^ (w[t - 8] as number) ^ (w[t - 14] as number) ^ (w[t - 16] as number)
      w[t] = (x << 1) | (x >>> 31)
    }
    let [a, bb, c, d, e] = this.h as unknown as [number, number, number, number, number]
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = (bb & c) | (~bb & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = bb ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (bb & c) | (bb & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = bb ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[t] as number)) >>> 0
      e = d
      d = c
      c = (bb << 30) | (bb >>> 2)
      bb = a
      a = temp
    }
    this.h[0] = ((this.h[0] as number) + a) >>> 0
    this.h[1] = ((this.h[1] as number) + bb) >>> 0
    this.h[2] = ((this.h[2] as number) + c) >>> 0
    this.h[3] = ((this.h[3] as number) + d) >>> 0
    this.h[4] = ((this.h[4] as number) + e) >>> 0
  }
}
