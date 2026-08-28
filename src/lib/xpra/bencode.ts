/**
 * xpra-flavored bencode.
 *
 * xpra distinguishes raw byte strings ("N:...", decoded to Uint8Array)
 * from unicode strings ("uN:...", utf-8). Salts and binary payloads use
 * byte strings, so the distinction must survive decode or HMAC breaks.
 */

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

function isLatin1(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xff) return false
  }
  return true
}

function latin1Bytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

export type BencodeValue = null | boolean | number | string | Uint8Array | BencodeValue[] | { [k: string]: BencodeValue }

class Sink {
  chunks: Uint8Array[] = []
  size = 0
  push(b: Uint8Array | string) {
    const c = typeof b === 'string' ? latin1Bytes(b) : b
    this.chunks.push(c)
    this.size += c.length
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }
}

function encodeInto(v: BencodeValue, s: Sink): void {
  if (v === null || v === undefined) throw new Error('cannot bencode null')
  if (typeof v === 'boolean') {
    s.push('i' + (v ? 1 : 0) + 'e')
  } else if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('cannot bencode non-integer: ' + v)
    s.push('i' + v + 'e')
  } else if (v instanceof Uint8Array) {
    s.push(v.length + ':')
    s.push(v)
  } else if (typeof v === 'string') {
    if (isLatin1(v)) {
      // xpra sends plain strings as latin-1 byte strings (same as the reference client)
      s.push(v.length + ':')
      s.push(v)
    } else {
      const b = utf8Encoder.encode(v)
      s.push('u' + b.length + ':')
      s.push(b)
    }
  } else if (Array.isArray(v)) {
    s.push('l')
    for (const item of v) encodeInto(item, s)
    s.push('e')
  } else if (typeof v === 'object') {
    s.push('d')
    for (const [k, item] of Object.entries(v)) {
      if (item === undefined) continue
      encodeInto(k, s)
      encodeInto(item as BencodeValue, s)
    }
    s.push('e')
  } else {
    throw new Error('cannot bencode type: ' + typeof v)
  }
}

export function bencode(v: BencodeValue): Uint8Array {
  const s = new Sink()
  encodeInto(v, s)
  return s.bytes()
}

class Reader {
  constructor(public buf: Uint8Array, public pos = 0) {}

  peek(): number {
    if (this.pos >= this.buf.length) throw new Error('bencode: unexpected end of buffer')
    return this.buf[this.pos]
  }

  byte(c: number) {
    if (this.buf[this.pos] !== c) throw new Error('bencode: expected ' + String.fromCharCode(c) + ' at ' + this.pos)
    this.pos++
  }

  digitsUntil(stop: number): number {
    const start = this.pos
    while (this.pos < this.buf.length && this.buf[this.pos] !== stop) this.pos++
    if (this.pos >= this.buf.length) throw new Error('bencode: unterminated number')
    return parseInt(latin1(this.buf.subarray(start, this.pos)), 10)
  }

  value(): BencodeValue {
    const c = this.peek()
    if (c === 0x6c /* l */) {
      this.pos++
      const list: BencodeValue[] = []
      while (this.peek() !== 0x65 /* e */) list.push(this.value())
      this.pos++
      return list
    }
    if (c === 0x64 /* d */) {
      this.pos++
      const dict: { [k: string]: BencodeValue } = {}
      while (this.peek() !== 0x65 /* e */) {
        const key = this.value()
        const val = this.value()
        dict[bytesToKey(key)] = val
      }
      this.pos++
      return dict
    }
    if (c === 0x69 /* i */) {
      this.pos++
      const n = this.digitsUntil(0x65 /* e */)
      this.pos++
      return n
    }
    if (c === 0x75 /* u */) {
      this.pos++
      const len = this.digitsUntil(0x3a /* : */)
      this.pos++
      const s = utf8Decoder.decode(this.buf.subarray(this.pos, this.pos + len))
      this.pos += len
      return s
    }
    if (c >= 0x30 && c <= 0x39) {
      const len = this.digitsUntil(0x3a /* : */)
      this.pos++
      const b = this.buf.slice(this.pos, this.pos + len)
      this.pos += len
      return b
    }
    throw new Error('bencode: invalid type byte: ' + c)
  }
}

function bytesToKey(v: BencodeValue): string {
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) return latin1(v)
  return String(v)
}

export function bdecode(buf: Uint8Array): BencodeValue {
  const r = new Reader(buf)
  return r.value()
}

/** Convert decoded bencode bytes/numbers to a JS string. */
export function asStr(v: BencodeValue | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) return latin1(v)
  return String(v)
}

/** Convert a JS string to raw bytes for sending. */
export function toBytes(s: string): Uint8Array {
  return latin1Bytes(s)
}
