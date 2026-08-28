/**
 * Auth digests for the xpra challenge/response flow.
 * Uses WebCrypto if available (secure context / HTTPS), and falls back
 * to pure JS SHA-256 / HMAC-SHA256 for plain HTTP on mobile LAN.
 */

import { asStr, toBytes } from './bencode'

export const OFFERED_DIGESTS = ['hmac+sha256', 'xor']

function toHex(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  return Array.from(u)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const len = data.length
  const bitLen = len * 8
  const padLen = (len % 64 < 56 ? 56 : 120) - (len % 64)
  const padded = new Uint8Array(len + padLen + 8)
  padded.set(data)
  padded[len] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, bitLen, false)

  const w = new Uint32Array(64)

  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false)
    }
    for (let j = 16; j < 64; j++) {
      const s0 =
        ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^
        ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^
        (w[j - 15] >>> 3)
      const s1 =
        ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^
        ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^
        (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let j = 0; j < 64; j++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0
      const S0 =
        ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, h0, false)
  outView.setUint32(4, h1, false)
  outView.setUint32(8, h2, false)
  outView.setUint32(12, h3, false)
  outView.setUint32(16, h4, false)
  outView.setUint32(20, h5, false)
  outView.setUint32(24, h6, false)
  outView.setUint32(28, h7, false)
  return out
}

function jsHmacSha256(keyBytes: Uint8Array, dataBytes: Uint8Array): Uint8Array {
  const blockSize = 64
  let k = keyBytes
  if (k.length > blockSize) {
    k = sha256Bytes(k)
  }
  const keyPad = new Uint8Array(blockSize)
  keyPad.set(k)

  const oKeyPad = new Uint8Array(blockSize)
  const iKeyPad = new Uint8Array(blockSize)

  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = keyPad[i] ^ 0x5c
    iKeyPad[i] = keyPad[i] ^ 0x36
  }

  const inner = new Uint8Array(blockSize + dataBytes.length)
  inner.set(iKeyPad)
  inner.set(dataBytes, blockSize)
  const innerHash = sha256Bytes(inner)

  const outer = new Uint8Array(blockSize + innerHash.length)
  outer.set(oKeyPad)
  outer.set(innerHash, blockSize)
  return sha256Bytes(outer)
}

async function hmacHex(hash: string, key: string, data: string): Promise<string> {
  const keyBytes = toBytes(key)
  const dataBytes = toBytes(data)

  if (typeof crypto !== 'undefined' && crypto?.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as Uint8Array<ArrayBuffer>,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      return toHex(
        await crypto.subtle.sign(
          'HMAC',
          cryptoKey,
          dataBytes as Uint8Array<ArrayBuffer>,
        ),
      )
    } catch {
      // Fallback if subtle fails
    }
  }

  // Pure JS HMAC-SHA256 fallback (works in non-secure HTTP contexts on mobile)
  return toHex(jsHmacSha256(keyBytes, dataBytes))
}

function xorString(a: string, b: string): string {
  const n = Math.min(a.length, b.length)
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(a.charCodeAt(i) ^ b.charCodeAt(i))
  return out
}

export async function gendigest(digest: string, key: string, data: string): Promise<string | null> {
  if (digest.startsWith('hmac')) {
    const hash = digest.includes('+') ? digest.split('+')[1] : 'sha256'
    if (hash === 'sha256') {
      return hmacHex(hash, key, data)
    }
    return null
  }
  if (digest === 'xor') return xorString(key, data.slice(0, key.length))
  return null
}

export function randomBytes(n: number): string {
  const u = new Uint8Array(n)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(u)
  } else {
    for (let i = 0; i < n; i++) {
      u[i] = Math.floor(Math.random() * 256)
    }
  }
  return asStr(u)
}
