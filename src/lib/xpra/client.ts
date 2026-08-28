/**
 * Minimal Xpra client: hello/caps negotiation, challenge auth, ping,
 * window tracking, draw packet routing, and input handling.
 * Ported from /usr/share/xpra/www/js/Client.js.
 */

import { XpraProtocol, type Packet } from './protocol'
import { gendigest, randomBytes, OFFERED_DIGESTS } from './crypto'
import { asStr, type BencodeValue } from './bencode'
import type { DrawPacket, DrawCallback } from './renderer'

export type ClientState = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'closed' | 'error'

export interface WindowState {
  wid: number
  x: number
  y: number
  w: number
  h: number
  metadata: Record<string, unknown>
  overrideRedirect: boolean
}

export interface XpraClientEvents {
  state: (state: ClientState, detail?: string) => void
  serverHello: (caps: Record<string, BencodeValue>) => void
  ping: (rttMs: number) => void
  packet: (name: string, packet: Packet) => void
  desktopSize: (w: number, h: number) => void
  window: (action: 'new' | 'move_resize' | 'lost', win: WindowState) => void
  draw: (packet: DrawPacket, done: DrawCallback) => void
}

export interface ConnectOptions {
  host: string
  port: number
  username?: string
  password?: string
  ssl?: boolean
  desktopSize?: [number, number]
}

const CLIENT_VERSION = '6.0.1'

export class XpraClient {
  private proto = new XpraProtocol()
  private caps: Record<string, BencodeValue> = {}
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pendingPing = 0
  private challengeCount = 0

  state: ClientState = 'idle'
  serverCaps: Record<string, BencodeValue> = {}
  windows: Map<number, WindowState> = new Map()
  focusWid = 0
  events: Partial<XpraClientEvents> = {}

  get connected() {
    return this.state === 'connected'
  }

  connect(opts: ConnectOptions) {
    this.setState('connecting')
    this.proto.events = {
      open: () => this.onOpen(opts),
      close: (reason) => {
        this.stopTimers()
        this.setState('closed', reason)
      },
      error: (msg) => this.setState('error', msg),
      packet: (p) => this.route(p, opts),
    }
    const uri = `${opts.ssl ? 'wss' : 'ws'}://${opts.host}:${opts.port}/`
    this.proto.connect(uri)
  }

  disconnect() {
    this.stopTimers()
    this.proto.close()
    this.windows.clear()
    this.focusWid = 0
    this.setState('closed')
  }

  send(packet: BencodeValue[]) {
    this.proto.send(packet)
  }

  sendPointerPosition(x: number, y: number, modifiers: string[] = [], buttons: number[] = [], wid?: number) {
    if (!this.connected) return
    const targetWid = wid ?? this.focusWid
    this.send(['pointer-position', targetWid, [Math.round(x), Math.round(y)], modifiers, buttons])
  }

  sendButtonAction(
    button: number,
    pressed: boolean,
    x: number,
    y: number,
    modifiers: string[] = [],
    buttons: number[] = [],
    wid?: number,
  ) {
    if (!this.connected) return
    const targetWid = wid ?? this.focusWid
    this.send(['button-action', targetWid, button, pressed, [Math.round(x), Math.round(y)], modifiers, buttons])
  }

  sendKeyAction(
    keyname: string,
    pressed: boolean,
    modifiers: string[] = [],
    keyval = 0,
    str = '',
    keycode = 0,
    wid?: number,
  ) {
    if (!this.connected) return
    const targetWid = wid ?? this.focusWid
    this.send(['key-action', targetWid, keyname, pressed, modifiers, keyval, str, keycode, 0])
  }

  sendKeyPress(keyname: string, modifiers: string[] = [], keyval = 0, str = '') {
    this.sendKeyAction(keyname, true, modifiers, keyval, str)
    setTimeout(() => {
      this.sendKeyAction(keyname, false, modifiers, keyval, str)
    }, 25)
  }

  private setState(state: ClientState, detail?: string) {
    if (state === 'error' || state === 'closed') this.stopTimers()
    this.state = state
    this.events.state?.(state, detail)
  }

  private stopTimers() {
    if (this.helloTimer) clearTimeout(this.helloTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.helloTimer = null
    this.pingTimer = null
  }

  private onOpen(opts: ConnectOptions) {
    this.helloTimer = setTimeout(() => {
      if (this.state !== 'connected') {
        this.setState('error', 'timeout waiting for server hello (not an Xpra server?)')
        this.proto.close()
      }
    }, 10000)
    this.makeHelloBase(opts)
    if (opts.password) {
      this.caps['challenge'] = true
      this.setState('authenticating')
      this.proto.send(['hello', this.caps])
    } else {
      this.makeHello(opts)
      this.proto.send(['hello', this.caps])
    }
  }

  // caps common to both the partial and final hello
  private makeHelloBase(opts: ConnectOptions) {
    this.caps = {
      version: CLIENT_VERSION,
      platform: 'Linux',
      'platform.name': 'Linux',
      'platform.platform': typeof navigator !== 'undefined' ? navigator.appVersion : '',
      'session-type': 'rem-web-client',
      'session-type.full': typeof navigator !== 'undefined' ? navigator.userAgent : '',
      client_type: 'HTML5',
      namespace: true,
      'websocket.multi-packet': true,
      share: true,
      steal: true,
      username: opts.username ?? '',
      display: '',
      digest: OFFERED_DIGESTS,
      'salt-digest': OFFERED_DIGESTS,
      zlib: true,
      lzo: false,
      compression_level: 1,
      rencode: false,
      bencode: true,
      yaml: false,
      'ping-echo-sourceid': true,
      'encoding.generic': true,
      'clipboard.contents-slice-fix': true,
    }
  }

  // extra caps only sent once authentication succeeded
  private makeHello(opts: ConnectOptions) {
    const [w, h] = opts.desktopSize ?? [1280, 720]
    Object.assign(this.caps, {
      auto_refresh_delay: 500,
      randr_notify: true,
      'server-window-resize': true,
      'notify-startup-complete': true,
      'generic-rgb-encodings': true,
      encodings: ['rgb', 'rgb32', 'jpeg', 'png', 'webp'],
      'encodings.core': ['rgb', 'rgb32', 'jpeg', 'png', 'webp'],
      'encodings.rgb_formats': ['RGBX', 'RGBA'],
      'encodings.window-icon': ['png'],
      'encodings.cursor': ['png'],
      'encoding.flush': true,
      'encoding.transparency': true,
      'encoding.client_options': true,
      windows: true,
      keyboard: true,
      clipboard: false,
      notifications: true,
      cursors: true,
      bell: false,
      'system_tray': false,
      'file-transfer': false,
      printing: false,
      'sound.receive': false,
      'sound.send': false,
      desktop_size: [w, h],
      'desktop_mode_size': [w, h],
    })
  }

  private async route(packet: Packet, opts: ConnectOptions) {
    const name = asStr(packet[0])
    this.events.packet?.(name, packet)
    switch (name) {
      case 'hello':
        this.onServerHello(packet)
        break
      case 'challenge':
        await this.onChallenge(packet, opts)
        break
      case 'auth':
        // auth ok
        break
      case 'ping':
        this.onPing(packet)
        break
      case 'ping_echo':
        this.onPingEcho(packet)
        break
      case 'desktop_size':
        this.onDesktopSize(packet)
        break
      case 'new-window':
        this.onNewWindow(packet, false)
        break
      case 'new-override-redirect':
        this.onNewWindow(packet, true)
        break
      case 'window-move-resize':
        this.onWindowMoveResize(packet)
        break
      case 'window-resized':
        this.onWindowResized(packet)
        break
      case 'lost-window':
        this.onLostWindow(packet)
        break
      case 'draw':
        this.onDraw(packet)
        break
      case 'disconnect':
        this.stopTimers()
        this.setState('closed', asStr(packet[1]) || 'disconnected by server')
        this.proto.close()
        break
    }
  }

  private onServerHello(packet: Packet) {
    if (this.helloTimer) clearTimeout(this.helloTimer)
    this.serverCaps = (packet[1] ?? {}) as Record<string, BencodeValue>
    this.setState('connected')
    this.events.serverHello?.(this.serverCaps)
    this.startPings()
  }

  private async onChallenge(packet: Packet, opts: ConnectOptions) {
    // A second challenge means the server rejected our response:
    // xpra re-challenges on failed auth instead of disconnecting.
    if (++this.challengeCount > 1) {
      this.setState('error', 'authentication failed (wrong username or password)')
      this.proto.close()
      return
    }
    // ["challenge", salt, auth-caps, digest, salt-digest, prompt]
    const serverSalt = asStr(packet[1] as BencodeValue)
    const digest = asStr(packet[3]) || 'hmac+sha256'
    const saltDigest = asStr(packet[4]) || 'xor'
    const clientSalt = randomBytes(32)
    const salt = await gendigest(saltDigest, clientSalt, serverSalt)
    const response = salt ? await gendigest(digest, opts.password ?? '', salt) : null
    if (!response) {
      this.setState('error', `unsupported digest: ${digest} / ${saltDigest}`)
      this.proto.close()
      return
    }
    this.makeHello(opts)
    delete this.caps['challenge']
    this.caps['challenge_response'] = response
    this.caps['challenge_client_salt'] = clientSalt
    this.proto.send(['hello', this.caps])
  }

  private startPings() {
    this.sendPing()
    this.pingTimer = setInterval(() => this.sendPing(), 15000)
  }

  private sendPing() {
    if (this.state !== 'connected') return
    this.pendingPing = Math.ceil(performance.now())
    this.proto.send(['ping', this.pendingPing])
  }

  private onPing(packet: Packet) {
    const echotime = packet[1]
    const sid = packet.length >= 4 ? asStr(packet[3]) : ''
    this.proto.send(['ping_echo', echotime, 0, 0, 0, 0, sid])
  }

  private onPingEcho(packet: Packet) {
    const echoed = typeof packet[1] === 'number' ? (packet[1] as number) : 0
    if (this.pendingPing && echoed === this.pendingPing) {
      this.events.ping?.(Math.ceil(performance.now()) - this.pendingPing)
    }
  }

  private onDesktopSize(packet: Packet) {
    const w = typeof packet[1] === 'number' ? packet[1] : 0
    const h = typeof packet[2] === 'number' ? packet[2] : 0
    this.events.desktopSize?.(w, h)
  }

  private onNewWindow(packet: Packet, overrideRedirect: boolean) {
    const wid = typeof packet[1] === 'number' ? packet[1] : 0
    const x = typeof packet[2] === 'number' ? packet[2] : 0
    const y = typeof packet[3] === 'number' ? packet[3] : 0
    const w = typeof packet[4] === 'number' ? packet[4] : 0
    const h = typeof packet[5] === 'number' ? packet[5] : 0
    const metadata = (packet[6] && typeof packet[6] === 'object' ? packet[6] : {}) as Record<string, unknown>

    const win: WindowState = { wid, x, y, w, h, metadata, overrideRedirect }
    this.windows.set(wid, win)
    if (!this.focusWid) {
      this.focusWid = wid
    }

    if (!overrideRedirect) {
      this.proto.send(['map-window', wid, x, y, w, h, { 'encodings.rgb_formats': ['RGBX', 'RGBA'] }])
      this.proto.send(['focus', wid, []])
    }

    this.events.window?.('new', win)
  }

  private onWindowMoveResize(packet: Packet) {
    const wid = typeof packet[1] === 'number' ? packet[1] : 0
    const x = typeof packet[2] === 'number' ? packet[2] : 0
    const y = typeof packet[3] === 'number' ? packet[3] : 0
    const w = typeof packet[4] === 'number' ? packet[4] : 0
    const h = typeof packet[5] === 'number' ? packet[5] : 0

    const existing = this.windows.get(wid)
    const win: WindowState = existing
      ? { ...existing, x, y, w, h }
      : { wid, x, y, w, h, metadata: {}, overrideRedirect: false }
    this.windows.set(wid, win)
    this.events.window?.('move_resize', win)
  }

  private onWindowResized(packet: Packet) {
    const wid = typeof packet[1] === 'number' ? packet[1] : 0
    const w = typeof packet[2] === 'number' ? packet[2] : 0
    const h = typeof packet[3] === 'number' ? packet[3] : 0

    const existing = this.windows.get(wid)
    const win: WindowState = existing
      ? { ...existing, w, h }
      : { wid, x: 0, y: 0, w, h, metadata: {}, overrideRedirect: false }
    this.windows.set(wid, win)
    this.events.window?.('move_resize', win)
  }

  private onLostWindow(packet: Packet) {
    const wid = typeof packet[1] === 'number' ? packet[1] : 0
    const existing = this.windows.get(wid)
    this.windows.delete(wid)
    if (this.focusWid === wid) {
      const nextWid = this.windows.keys().next().value
      this.focusWid = typeof nextWid === 'number' ? nextWid : 0
    }
    this.events.window?.(
      'lost',
      existing ?? { wid, x: 0, y: 0, w: 0, h: 0, metadata: {}, overrideRedirect: false },
    )
  }

  private onDraw(packet: Packet) {
    const wid = typeof packet[1] === 'number' ? packet[1] : 0
    const x = typeof packet[2] === 'number' ? packet[2] : 0
    const y = typeof packet[3] === 'number' ? packet[3] : 0
    const w = typeof packet[4] === 'number' ? packet[4] : 0
    const h = typeof packet[5] === 'number' ? packet[5] : 0
    const coding = asStr(packet[6])
    const data = packet[7] as Uint8Array | unknown[]
    const packetSequence = typeof packet[8] === 'number' ? packet[8] : 0
    const rowstride = typeof packet[9] === 'number' ? packet[9] : 0
    const options = (packet[10] && typeof packet[10] === 'object' ? packet[10] : {}) as Record<string, unknown>

    const drawPacket: DrawPacket = {
      wid,
      x,
      y,
      w,
      h,
      coding,
      data,
      packetSequence,
      rowstride,
      options,
    }

    const sendDamageSequence = (decodeTimeUs: number, errorMsg = '') => {
      this.proto.send(['damage-sequence', packetSequence, wid, w, h, decodeTimeUs, errorMsg])
    }

    if (this.events.draw) {
      this.events.draw(drawPacket, sendDamageSequence)
    } else {
      sendDamageSequence(-1, 'no draw handler attached')
    }
  }
}
