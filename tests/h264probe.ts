/**
 * h264 wire-format probe: connects advertising h264 caps, logs draw packet
 * codings and dumps h264 frame options + hex heads so the decoder can be
 * written against ground truth (not guesses).
 * Usage: XPRA_HOST=... XPRA_PORT=... XPRA_USER=... XPRA_PASS=... node tests/h264probe.js
 */
import { WebSocket } from 'ws'
;(globalThis as Record<string, unknown>).WebSocket = WebSocket
import { XpraClient } from '../src/lib/xpra/client'
import { asStr } from '../src/lib/xpra/bencode'

const client = new XpraClient()
const counts: Record<string, number> = {}
let h264Dumps = 0
const MAX_DUMP = 6
// replay capture: frame data + options for browser-side decode test
const recorded: Array<{ opts: Record<string, unknown>; b64: string }> = []

function hexHead(data: Uint8Array, n: number): string {
  const parts: string[] = []
  for (let i = 0; i < Math.min(n, data.length); i++) {
    parts.push(data[i].toString(16).padStart(2, '0'))
  }
  return parts.join(' ')
}

client.events.state = (state, detail) => {
  console.log(`[state] ${state}${detail ? ' — ' + detail : ''}`)
  if (state === 'connected') {
    console.log('[server] encodings:', JSON.stringify(client.serverCaps.encodings))
  }
  if (state === 'error' || state === 'closed') {
    console.error('FAILED:', state, detail)
    process.exit(1)
  }
}

client.events.draw = (_packet, done) => {
  // Must ack success — error acks make the server destroy the x264 encoder
  // (client_decode_error → cleanup_codecs), forcing a fresh IDR every frame
  // and poisoning any bandwidth measurement.
  done(500)
}

client.events.packet = (name, packet) => {
  if (name === 'draw') {
    // ['draw', wid, x, y, w, h, coding, data, rowstride, options, ...]
    const coding = asStr(packet[6])
    counts[coding] = (counts[coding] || 0) + 1
    if (coding === 'h264') {
      const data = packet[7]
      if (data instanceof Uint8Array) {
        recorded.push({ opts: { ...(packet[10] as Record<string, unknown>) }, b64: Buffer.from(data).toString('base64') })
      }
      if (h264Dumps < MAX_DUMP) {
        h264Dumps++
        const opts = packet[10] ?? {}
        console.log('--- h264 draw ---')
        console.log('wid:', packet[1], 'x,y:', packet[2], packet[3], 'w,h:', packet[4], packet[5])
        console.log('seq:', packet[8], 'rowstride:', packet[9], 'type:', data?.constructor?.name, 'len:', data instanceof Uint8Array ? data.length : -1)
        console.log('options:', JSON.stringify(opts))
        if (data instanceof Uint8Array) {
          console.log('head:', hexHead(data, 24))
          // Annex-B start codes: 00 00 00 01 / 00 00 01; NAL type = byte & 0x1f
          let i = 0
          const nalTypes: number[] = []
          while (i < data.length - 4 && nalTypes.length < 8) {
            if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
              nalTypes.push(data[i + 3] & 0x1f)
              i += 3
            } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
              nalTypes.push(data[i + 4] & 0x1f)
              i += 4
            } else {
              i++
            }
          }
          console.log('annexb NAL types:', nalTypes.join(','))
        }
      }
    }
  }
  if (name === 'eos') console.log('[eos] wid:', packet[1])
}

client.connect({
  host: process.env.XPRA_HOST || '127.0.0.1',
  port: parseInt(process.env.XPRA_PORT || '10000', 10),
  username: process.env.XPRA_USER || '',
  password: process.env.XPRA_PASS || '',
  ssl: false,
  desktopSize: [1280, 720],
  quality: 'saver',
  h264: true,
})

setTimeout(() => {
  console.log('\n=== draw packet counts ===')
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)
  console.log('h264 frames dumped:', h264Dumps)
  if (process.env.H264_CAPTURE) {
    const fs = require('fs') as typeof import('fs')
    fs.writeFileSync(process.env.H264_CAPTURE, JSON.stringify(recorded))
    console.log('captured', recorded.length, 'h264 frames ->', process.env.H264_CAPTURE)
  }
  client.disconnect()
  process.exit(0)
}, 25000)
