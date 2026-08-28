/**
 * Node smoke test: connect to a running xpra server and complete auth.
 * Usage: XPRA_HOST=127.0.0.1 XPRA_PORT=10000 XPRA_USER=hyper2 XPRA_PASS=secret node tests/smoke.js
 */
import { WebSocket } from 'ws'
;(globalThis as Record<string, unknown>).WebSocket = WebSocket
import { XpraClient } from '../src/lib/xpra/client'

const client = new XpraClient()
let done = false

client.events.state = (state, detail) => {
  console.log(`[state] ${state}${detail ? ' — ' + detail : ''}`)
  if (state === 'connected' && !done) {
    done = true
    const caps = client.serverCaps
    console.log('[server] version:', caps.version)
    console.log('[server] shadow:', caps.shadow)
    console.log('[server] encodings:', JSON.stringify(caps.encodings))
    console.log('[server] display:', caps.display)
  }
  if (state === 'error' || state === 'closed') {
    if (!done) {
      console.error('FAILED before connect:', state, detail)
      process.exit(1)
    }
  }
}
client.events.ping = (rtt) => console.log(`[ping] rtt=${rtt}ms`)

client.connect({
  host: process.env.XPRA_HOST || '127.0.0.1',
  port: parseInt(process.env.XPRA_PORT || '10000', 10),
  username: process.env.XPRA_USER || '',
  password: process.env.XPRA_PASS || '',
  ssl: false,
  desktopSize: [1280, 720],
})

setTimeout(() => {
  if (!done) {
    console.error('FAILED: timeout')
    process.exit(1)
  }
  console.log('OK')
  client.disconnect()
  process.exit(0)
}, 8000)
