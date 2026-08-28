/**
 * Xpra wire protocol over WebSocket.
 * Port of /usr/share/xpra/www/js/Protocol.js (worker variant dropped,
 * zlib handled via DecompressionStream instead of inflate.js).
 *
 * Header: 'P', proto_flags, level, index, u32be packet-size.
 * Packets with index > 0 carry raw binary chunks that get spliced into
 * the following index == 0 packet at position `index`.
 */

import { bdecode, bencode, type BencodeValue } from './bencode'

export type Packet = BencodeValue[]

const MAGIC = 0x50 // 'P'

export interface ProtocolEvents {
  open: () => void
  close: (reason?: string) => void
  error: (msg: string) => void
  packet: (packet: Packet) => void
}

export async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  // xpra uses python zlib (zlib wrapper) == DecompressionStream('deflate')
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

export class XpraProtocol {
  private ws: WebSocket | null = null
  private rQ: Uint8Array[] = []
  private header: number[] = []
  private rawPackets: Map<number, Uint8Array> = new Map()
  private processing = false
  private closed = false
  events: Partial<ProtocolEvents> = {}

  connect(uri: string) {
    this.ws = new WebSocket(uri, 'binary')
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => this.events.open?.()
    this.ws.onclose = () => {
      this.closed = true
      this.events.close?.()
    }
    this.ws.onerror = () => this.events.error?.('WebSocket error')
    this.ws.onmessage = (e: MessageEvent) => {
      this.rQ.push(new Uint8Array(e.data as ArrayBuffer))
      void this.drain()
    }
  }

  close() {
    this.closed = true
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
  }

  send(packet: BencodeValue) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const payload = bencode(packet)
    const header = new Uint8Array(8)
    header[0] = MAGIC
    header[1] = 0 // proto flags: no encryption
    header[2] = 0 // compression level: none
    header[3] = 0 // index: complete packet
    new DataView(header.buffer).setUint32(4, payload.length, false)
    const out = new Uint8Array(8 + payload.length)
    out.set(header, 0)
    out.set(payload, 8)
    this.ws.send(out)
  }

  private fail(msg: string) {
    this.header = []
    this.rQ = []
    this.events.error?.(msg)
    this.events.close?.(msg)
    this.close()
  }

  private takeBytes(n: number): Uint8Array | null {
    let total = 0
    for (const s of this.rQ) total += s.length
    if (total < n) return null
    const out = new Uint8Array(n)
    let off = 0
    while (off < n) {
      const slice = this.rQ[0]
      const need = n - off
      if (slice.length > need) {
        out.set(slice.subarray(0, need), off)
        this.rQ[0] = slice.subarray(need)
        off += need
      } else {
        out.set(slice, off)
        off += slice.length
        this.rQ.shift()
      }
    }
    return out
  }

  private async drain() {
    if (this.processing) return
    this.processing = true
    try {
      while (!this.closed && this.header.length >= 0) {
        if (this.header.length < 8) {
          // fill header byte-by-byte from queue
          while (this.header.length < 8 && this.rQ.length > 0) {
            const slice = this.rQ[0]
            const need = 8 - this.header.length
            const n = Math.min(need, slice.length)
            for (let i = 0; i < n; i++) this.header.push(slice[i])
            if (slice.length > need) this.rQ[0] = slice.subarray(n)
            else this.rQ.shift()
          }
          if (this.header.length < 8) return
          if (this.header[0] !== MAGIC) {
            this.fail('invalid packet header format: ' + this.header[0])
            return
          }
        }

        const level = this.header[2]
        const index = this.header[3]
        const packetSize = (this.header[4] << 24 >>> 0) + (this.header[5] << 16) + (this.header[6] << 8) + this.header[7]
        if (index >= 20) {
          this.fail('invalid packet index: ' + index)
          return
        }
        if (level & 0x20) {
          this.fail('lzo compression is not supported')
          return
        }
        if (level & 0x40) {
          this.fail('brotli compression is not supported')
          return
        }
        const packetData = this.takeBytes(packetSize)
        if (!packetData) return // keep header, wait for the rest of the body
        this.header = []

        let payload = packetData
        if (level !== 0) {
          try {
            payload = await inflateZlib(packetData)
          } catch (e) {
            this.fail('failed to decompress zlib data: ' + e)
            return
          }
        }

        if (index > 0) {
          this.rawPackets.set(index, payload)
          continue
        }

        let packet: BencodeValue
        try {
          packet = bdecode(payload)
        } catch (e) {
          // reference client logs and skips; keep the stream alive
          this.events.error?.('error decoding packet: ' + e)
          continue
        }
        if (Array.isArray(packet)) {
          for (const [i, raw] of this.rawPackets) {
            ;(packet as BencodeValue[])[i] = raw
          }
          this.rawPackets = new Map()
          this.events.packet?.(packet as Packet)
        }
      }
    } finally {
      this.processing = false
    }
  }
}
