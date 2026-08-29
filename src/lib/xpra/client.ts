/**
 * Minimal Xpra client: hello/caps negotiation, challenge auth, ping,
 * window tracking, draw packet routing, and input handling.
 * Ported from /usr/share/xpra/www/js/Client.js.
 */

import { XpraProtocol, type Packet } from './protocol'
import { gendigest, randomBytes, OFFERED_DIGESTS } from './crypto'
import { asStr, type BencodeValue } from './bencode'
import { getKeyInfo } from './keycodes'
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
  clipboardBuffer = ''
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
    if (modifiers.length > 0) {
      this.sendKeyCombo(keyname, modifiers, keyval, str)
      return
    }
    const info = getKeyInfo(keyname)
    const kn = info.keyname
    const kv = keyval || info.keyval
    this.sendKeyAction(kn, true, [], kv, str)
    setTimeout(() => {
      this.sendKeyAction(kn, false, [], kv, str)
    }, 35)
  }

  async sendText(text: string, pressEnter = false, delayMs = 4): Promise<void> {
    if (!this.connected) return

    for (const ch of text) {
      if (ch === '\n' || ch === '\r') {
        this.sendKeyAction('Return', true, [], 0xff0d, '\n')
        await new Promise((r) => setTimeout(r, delayMs))
        this.sendKeyAction('Return', false, [], 0xff0d, '\n')
      } else {
        const info = getKeyInfo(ch)
        const isUpper = ch >= 'A' && ch <= 'Z'
        const mods = isUpper ? ['shift'] : []
        if (isUpper) {
          this.sendKeyAction('Shift_L', true, mods, 0xffe1, '')
          await new Promise((r) => setTimeout(r, 4))
        }
        this.sendKeyAction(info.keyname, true, mods, info.keyval, ch)
        await new Promise((r) => setTimeout(r, delayMs))
        this.sendKeyAction(info.keyname, false, mods, info.keyval, ch)
        if (isUpper) {
          await new Promise((r) => setTimeout(r, 4))
          this.sendKeyAction('Shift_L', false, [], 0xffe1, '')
        }
      }
      await new Promise((r) => setTimeout(r, delayMs))
    }

    if (pressEnter) {
      await new Promise((r) => setTimeout(r, delayMs))
      this.sendKeyAction('Return', true, [], 0xff0d, '\n')
      await new Promise((r) => setTimeout(r, delayMs))
      this.sendKeyAction('Return', false, [], 0xff0d, '\n')
    }
  }

  sendClipboardText(text: string) {
    if (!this.connected) return
    this.clipboardBuffer = text
    const claim = true
    const greedy = true
    const synchronous = true
    const targets = [
      'UTF8_STRING',
      'text/plain',
      'text/plain;charset=utf-8',
      'STRING',
      'TEXT',
      'COMPOUND_TEXT',
    ]

    // Set CLIPBOARD
    this.send([
      'clipboard-token',
      'CLIPBOARD',
      targets,
      'UTF8_STRING',
      'UTF8_STRING',
      8,
      'bytes',
      text,
      claim,
      greedy,
      synchronous,
    ])

    // Set PRIMARY selection (for X11 terminals and editors)
    this.send([
      'clipboard-token',
      'PRIMARY',
      targets,
      'UTF8_STRING',
      'UTF8_STRING',
      8,
      'bytes',
      text,
      claim,
      greedy,
      synchronous,
    ])
  }

  async pasteTextToRemote(text: string): Promise<void> {
    if (!this.connected) return
    this.sendClipboardText(text)
    await new Promise((r) => setTimeout(r, 60))
    // Trigger Shift+Insert (Universal Linux terminal & desktop paste)
    this.sendKeyCombo('Insert', ['shift'])
    // Also trigger Ctrl+V for GTK/Electron/browser apps
    await new Promise((r) => setTimeout(r, 40))
    this.sendKeyCombo('v', ['control'])
  }

  sendKeyCombo(keyname: string, modifiers: string[] = [], keyval = 0, str = '') {
    if (!this.connected) return

    const keyInfo = getKeyInfo(keyname)
    const targetKeyname = keyInfo.keyname
    const targetKeyval = keyval || keyInfo.keyval

    // Expand modifier names (e.g. ['alt'] -> ['mod1', 'alt'], ['meta'] -> ['mod4', 'meta'])
    const expandedMods: string[] = []
    const modKeyEvents: { keyname: string; keyval: number }[] = []

    for (const mod of modifiers) {
      const m = mod.toLowerCase()
      if (m === 'alt' || m === 'mod1') {
        if (!expandedMods.includes('mod1')) expandedMods.push('mod1')
        if (!expandedMods.includes('alt')) expandedMods.push('alt')
        modKeyEvents.push({ keyname: 'Alt_L', keyval: 0xffe9 })
      } else if (m === 'control' || m === 'ctrl') {
        if (!expandedMods.includes('control')) expandedMods.push('control')
        modKeyEvents.push({ keyname: 'Control_L', keyval: 0xffe3 })
      } else if (m === 'shift') {
        if (!expandedMods.includes('shift')) expandedMods.push('shift')
        modKeyEvents.push({ keyname: 'Shift_L', keyval: 0xffe1 })
      } else if (m === 'meta' || m === 'super' || m === 'mod4') {
        if (!expandedMods.includes('mod4')) expandedMods.push('mod4')
        if (!expandedMods.includes('meta')) expandedMods.push('meta')
        modKeyEvents.push({ keyname: 'Meta_L', keyval: 0xffe7 })
      }
    }

    // 1. Press modifier keys down with proper keysyms
    for (const mk of modKeyEvents) {
      this.sendKeyAction(mk.keyname, true, expandedMods, mk.keyval, '')
    }

    // 2. Press target key (e.g. Tab) while modifiers are held down
    setTimeout(() => {
      this.sendKeyAction(targetKeyname, true, expandedMods, targetKeyval, str)

      // 3. Release target key
      setTimeout(() => {
        this.sendKeyAction(targetKeyname, false, expandedMods, targetKeyval, str)

        // 4. Release modifier keys
        setTimeout(() => {
          for (const mk of modKeyEvents) {
            this.sendKeyAction(mk.keyname, false, [], mk.keyval, '')
          }
        }, 100)
      }, 100)
    }, 80)
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

  sendDesktopSize(width: number, height: number, dpi = 96) {
    if (!this.connected) return
    const screenSizes = this.getScreenSizes(width, height, dpi)
    this.send(['desktop_size', Math.round(width), Math.round(height), screenSizes])
  }

  private getScreenSizes(w: number, h: number, dpi = 96) {
    const wmm = Math.round((w * 25.4) / dpi)
    const hmm = Math.round((h * 25.4) / dpi)
    const monitor = ['Canvas', 0, 0, w, h, wmm, hmm]
    const screen = ['HTML', w, h, wmm, hmm, [monitor], 0, 0, w, h]
    return [screen]
  }

  // extra caps only sent once authentication succeeded
  private makeHello(opts: ConnectOptions) {
    const [w, h] = opts.desktopSize ?? [1200, 750]
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
      xkbmap_layout: 'us',
      xkbmap_print: '',
      xkbmap_query: '',
      clipboard: true,
      'clipboard.selections': ['CLIPBOARD', 'PRIMARY'],
      'clipboard.want_targets': true,
      'clipboard.greedy': true,
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
      screen_sizes: this.getScreenSizes(w, h),
      dpi: 96,
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
      case 'clipboard-request':
        this.onClipboardRequest(packet)
        break
      case 'clipboard-token':
        this.onClipboardToken(packet)
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

    const rootSize = this.serverCaps['actual_desktop_size'] || this.serverCaps['desktop_size']
    if (Array.isArray(rootSize) && rootSize.length >= 2) {
      const rw = Number(rootSize[0])
      const rh = Number(rootSize[1])
      if (rw > 0 && rh > 0) {
        this.events.desktopSize?.(rw, rh)
      }
    }

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

  private onClipboardRequest(packet: Packet) {
    const requestId = packet[1]
    const selection = asStr(packet[2]) || 'CLIPBOARD'
    const target = packet.length > 3 ? asStr(packet[3]) : 'UTF8_STRING'

    const buffer = this.clipboardBuffer || ''
    if (!buffer) {
      this.send(['clipboard-contents-none', requestId, selection])
    } else {
      this.send([
        'clipboard-contents',
        requestId,
        selection,
        target || 'UTF8_STRING',
        8,
        'bytes',
        buffer,
      ])
    }
  }

  private onClipboardToken(_packet: Packet) {
    // Preserve local user clipboard buffer for repeated paste actions
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
