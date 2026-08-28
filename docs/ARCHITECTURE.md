# ARCHITECTURE.md

Technical design of `rem`, plus verified facts about the Xpra 3.1.5 wire
protocol. Everything marked **verified** was confirmed against the
version-matched reference client and the Python server on the dev machine
(`/usr/share/xpra/www/js/`, `/usr/lib/python3/dist-packages/xpra/`), not
from xpra's published docs (which are stale for 3.x).

## Layering

```
┌─────────────────────────────────────────────┐
│ Svelte UI  (views/, components/)            │  declarative chrome:
│   Home · Session · (M4) RemoteCanvas · Kbd  │  lists, status, keyboards
├─────────────────────────────────────────────┤
│ src/lib/session/ (planned)                  │  writable store glue:
│   RemoteSession: client + renderer state    │  subscribes client events,
│                                             │  exposes runes-friendly API
├─────────────────────────────────────────────┤
│ src/lib/xpra/  ← FRAMEWORK-FREE             │  plain TS, runs in Node:
│   client.ts    handshake/auth state machine │
│   protocol.ts  framing + zlib + splice      │
│   bencode.ts   xpra-flavored bencode        │
│   crypto.ts    HMAC/xor via WebCrypto       │
│   (M3) renderer.ts  canvas paint pipeline   │
├─────────────────────────────────────────────┤
│ WebSocket (binary) → Xpra server :10000     │
└─────────────────────────────────────────────┘
```

Rules:
- `src/lib/xpra/` must never import Svelte or touch DOM (canvas is the only
  allowed exception, and it arrives as an injected element in renderer.ts).
- UI never pokes protocol internals; it listens to `XpraClient.events`
  (`state`, `serverHello`, `ping`, `packet`).

## The wire protocol (verified)

### Framing

Every WebSocket message is a stream of frames (not necessarily one frame
per WS message; the receive queue handles arbitrary splits):

```
byte 0   'P' (0x50)   magic
byte 1   proto flags  (0x2 = RSA-AES crypt; we don't support it → treat as error)
byte 2   compression level: 0x10 lz4 | 0x20 lzo | 0x40 brotli |
         else 0x00 none | 0x08.. zlib (python compresslevel in low bits)
byte 3   index: 0 = complete packet; >0 = raw payload for packet slot <index>
bytes 4–7  u32 big-endian payload size
payload   bencoded (if index==0) or raw binary (if index>0)
```

**Raw splice:** server sends big binary blobs (pixel data) as separate
index>0 frames *before* the bencoded packet that references them; the client
stores `rawPackets[index]` and overwrites `packet[index]` after bdecoding
the index-0 packet. Draw pixel data therefore lands at `packet[7]`.
(Multiple raws per packet are fine; index max 19 in practice.)

**Compression:** we advertise `zlib: true, lzo: false` and
`compression_level: 1`; server then uses zlib (python `zlib.compress` →
zlib container = `DecompressionStream('deflate')`) or sends uncompressed.
lz4/brotli never appear since we don't offer them. We always send
uncompressed (level 0) — inputs are tiny.

### Bencode (xpra flavor)

Standard bencode **plus** a bytes/string distinction (matches
`xpra/net/bencode/bencode.py`):

- `int` → `i<n>e`; bool → `i1e`/`i0e`
- **str** (needs non-latin1) → `u<utf8len>:<utf8>` — decode to JS string
- **bytes** (latin1-representable) → `<byteLen>:<bytes>` — decode to `Uint8Array`
- list `l...e`, dict `d(k v)...e` (sorted keys)

Encoder: a JS string that's all latin-1 encodes as *bytes* (what the
reference client does); non-latin1 gets the `u` prefix. Decode keeps
byte-strings as `Uint8Array` because salts are raw bytes. This is the #1
source of subtle auth failures if you "simplify" it.

### Connect + auth handshake

```
client                                server
  │ ── ws open (ws://host:10000/) ──────►│
  │ ["hello", caps{challenge:true,…}] ──►│   (partial hello; no pixel caps yet)
  │ ◄───────────── ["challenge", salt,   │
  │              auth-caps, digest,      │
  │              salt-digest, prompt]    │
  │ compute: clientSalt=rand32bytes      │
  │   salt = gendigest(saltDigest, clientSalt, serverSalt)
  │   resp = gendigest(digest, password, salt)
  │ ["hello", caps+{challenge_response,  │
  │  challenge_client_salt, encodings…}]►│
  │ ◄────────────────── ["hello", caps]  │   (server caps: version, shadow,
  │                                      │    encodings, display, …)
```

- `gendigest("hmac+sha256", key, data)` = hex(HMAC-SHA256(key, data)).
  Salt digest chosen the same way. We offer `["hmac+sha256","xor"]`;
  server's `choose_digest` picks the strongest common one → hmac+sha256.
  The `xor` fallback needs string-length gymnastics; effectively unused.
- Server **re-sends `challenge` on bad credentials** (no error packet).
  Second challenge = auth failed → close. (client.ts `challengeCount`.)
- After `hello`, xpra may send `["auth", ...]` and later
  `["startup-complete", ...]` before window packets.
- **Wrong server / non-xpra port**: hello timeout of 10s (we replicate).

### Ping / RTT

Either side may send `["ping", <float ms>, source-id?]`. Reply with
`["ping_echo", echotime, 0, 0, 0, 0, <source-id>]` (last elem only if
server advertised it / we sent `ping-echo-sourceid`). RTT =
`performance.now() - echoed`. We ping every 15s to keep NAT warm and to
measure latency. **verified: ~3ms LAN.**

### Client hello caps (current trimmed set, client.ts)

Identity: `version "6.0.1"`, `client_type HTML5`, platform strings,
`session-type rem-web-client`. Negotiation: `bencode:true`, `zlib:true`,
`compression_level:1`, `digest`/`salt-digest`, `challenge` only in the
partial hello. Post-auth: `encodings: [rgb, rgb32, jpeg, png]`,
`encodings.rgb_formats: [RGBX, RGBA]` (RGBX = B,G,R,0 little-endian word
→ treat as RGBA bytes on little-endian), `windows/keyboard/cursors/
notifications: true`, `clipboard:false`, sound/file/print off,
`desktop_size`/`desktop_mode_size` `[w,h]`, `share:true`, `steal:true`,
`encoding.flush:true`, `encoding.client_options:true`.

Adding `webp` is one entry — WebP is universally supported in mobile
browsers and probably the best lossy choice on phones (M3 decision).

## Packet routing today (client.ts)

Handled: `hello`, `challenge`, `auth`, `ping`, `ping_echo`, `disconnect`.
Every packet name flows to `events.packet` → Session view log (debug
instrumentation until M3). Unknown packets ignored by design.

## M3 draw pipeline design (in progress)

Port of `Client.js _process_draw_queue` + `Window.js do_paint` (the
single-window shadow case):

- Track desktop: `desktop_size [w,h]`, window id from `new-window`
  `[wid, x, y, w, h, metadata, …]`; honor `window-move-resize`
  `[wid, x, y, w, h]` and `lost-window`/`eos`.
- **Paint queue** per window: `do_paint` runs one at a time
  (`paint_pending` watchdog 2s), because jpeg/png/webp decode is async.
- `["draw", wid, x, y, w, h, coding, data, seq, rowstride, options]`:
  - `rgb32`: optional `options.zlib` per-packet inflate; `createImageData`,
    respect `rowstride` (copy rows); `putImageData` into offscreen.
  - `jpeg|png|webp`: `createImageBitmap(Blob(data))` (better than the
    reference's `Image`+base64 — zero base64 cost, off main thread) then
    `drawImage` at x,y.
  - `scroll`: `data = [[sx,sy,sw,sh,dx,dy],…]`, `drawImage(canvas, …)` copy
    rects onto the offscreen (this is the hot path for scrolling).
  - `options["flush"]` → swap buffers immediately (reference swaps on the
    next damage-sequence callback otherwise, via requestAnimationFrame).
- **Double buffer:** paint into `offscreenCanvas` (2D), blit to the visible
  canvas on rAF (`request_redraw` batching, one blit per frame).
- **damage-sequence** ack after paint:
  `["damage-sequence", seq, wid, w, h, decode_time_us, error_msg]`
  (decode_time −1 on error). The server's pacing/flow control depends on
  these — never skip them.

## UI model (M4–M6, planned)

- `RemoteSession` store owns `XpraClient` + `Renderer`; views render state.
- Portrait: display top-aligned, modifier strip + custom keyboard below;
  OS keyboard never overlays the remote view.
- Landscape: 25/50/25-ish split, left/right control columns around a
  near-square viewport (viewport = pan/zoom window into desktop, not fit).
- Input (M4): `button-action [wid, b1, press, x, y, …]`,
  `pointer-position`, `key-action`, `keymap-changed` — port Keycodes.js
  (X11 keysym table) for the layout; shortcut macros = sequences of
  key-actions with held modifiers.

## Security notes

- Passwords: plaintext in `localStorage` (user-approved prototype tradeoff;
  encrypt at rest before any public exposure). TLS via `wss` unsupported so
  far — offer it (`ssl` flag exists) once needed; self-signed certs on LAN
  xpra are the annoying part.
- `steal:true, share:true`: matches the stock HTML5 client; shadow sessions
  are view-only anyway.

## Known gaps / debts

- No `set-defaults` packet after hello yet (harmless at M2; add with M3).
- No `info` request, no clipboard, no audio, no window icons.
- renderer.ts not yet written — M3.
- Session view has no canvas; connect/disconnect churn is the only test.
- If a non-xpra host is reachable but slow, the 10s hello timer is the only
  guard; WS connect itself has no timeout.
