# AGENTS.md — working notes for AI agents / developers

Read this before touching the codebase. Product vision: `docs/VISION.md`.
Technical design + verified wire-format facts: `docs/ARCHITECTURE.md`.

## What this project is

A mobile-first web remote-desktop **client** (SPA) on top of the Xpra protocol.
We do NOT implement a remote-desktop protocol — we port the protocol client
layer from xpra's HTML5 client and build a completely custom phone UX
(persistent keyboard, portrait + landscape split layouts, shortcut macros).

## Commands

```bash
npm run dev      # vite dev server, :5173, --host for phone access
npm run build    # production build -> dist/
npm run check    # svelte-check (types) — must stay at 0 errors / 0 warnings
```

Tests (plain node scripts, no test framework):

```bash
# unit: bencode round-trips
node_modules/typescript/bin/tsc --ignoreConfig src/lib/xpra/bencode.ts tests/bencode.test.ts \
  --module commonjs --target es2022 --lib es2022,dom --outDir /tmp/opencode/xpra-build --esModuleInterop --strict
node /tmp/opencode/xpra-build/tests/bencode.test.js

# integration: full connect + auth + ping against a live xpra server (requires `ws` devDep)
node_modules/typescript/bin/tsc --ignoreConfig src/lib/xpra/*.ts tests/smoke.ts \
  --module commonjs --target es2022 --lib es2022,dom --outDir /tmp/opencode/xpra-build --esModuleInterop --strict --skipLibCheck
cd /tmp/opencode/xpra-build && NODE_PATH=<repo>/node_modules \
  XPRA_HOST=127.0.0.1 XPRA_PORT=10000 XPRA_USER=<u> XPRA_PASS=<p> node tests/smoke.js
```

TypeScript 6 quirks: file-list on the CLI needs `--ignoreConfig`. The build
output lives in /tmp because Node can't resolve `ws` from the repo when the
entry is outside it (`NODE_PATH` hack above).

## Server under test (dev machine, Linux)

```bash
xpra shadow --bind-ws=0.0.0.0:10000 :0     # shadows the running desktop, password auth
```

- xpra v3.1.5 installed system-wide. Logs: `/run/user/1000/xpra/:0.log`.
- The version-matched reference client is ON THIS MACHINE:
  `/usr/share/xpra/www/js/` (Client.js, Protocol.js, Window.js, Keycodes.js, Utilities.js).
- Python server side (ground truth for handshake semantics):
  `/usr/lib/python3/dist-packages/xpra/net/` (digest.py, auth.py, bencode/bencode.py)
  and `/usr/lib/python3/dist-packages/xpra/server/server_core.py`.

## Hard rules

1. **`src/lib/xpra/` stays framework-free.** No Svelte/DOM imports there
   (WebSocket, crypto, performance are fine). It must be unit-testable in Node.
   UI reads it only through `XpraClient` events.
2. **Don't invent packet formats.** xpra's published docs are stale for 3.x.
   The reference JS client is the spec. When a packet shape matters, read
   `/usr/share/xpra/www/js/*.js` (and the Python side for server semantics)
   before implementing.
3. `npm run check` must pass with 0 errors AND 0 warnings.

## Gotchas (each cost real debugging time)

- **Desktop mode + keyboard grab** (Session.svelte): screens ≥1024px with
  `pointer: fine` get a chrome-less layout (whole window = remote screen, no
  keyboards/panels). Full key grab needs fullscreen + `navigator.keyboard.lock()`
  (Chrome/Edge only, TS 6 lib.dom does NOT type it — local cast in
  `getKeyboardApi()`). Without the lock API, Esc is not interceptable: native
  browser exits fullscreen. Quit gestures: `Esc Esc` (double, 450ms) or the ✕
  chip; ⛶ chip toggles fullscreen. `window blur` releases stuck remote
  modifiers (Control/Alt/Shift/Meta) — a locked Alt+Tab would otherwise leave
  Alt "held down" on the remote.
- **Bencode is not standard bencode.** xpra distinguishes `bytes` from `str`:
  latin-1-only strings encode as plain `<len>:<bytes>`, others as `u<len>:<utf8>`.
  On decode, byte-strings MUST stay `Uint8Array` (HMAC salts are raw bytes —
  stringifying through utf-8 destroys them). See `bencode.ts`.
- **Never name a component variable `state`** (also `props`, `derived`, `effect`...).
  svelte2tsx (used by svelte-check) injects `let $state = store_get(state)` for
  reactive vars — a var literally named `state` collides and produces bogus
  "Cannot find name '$state'" errors in *other* files. We hit this in Session.svelte.
- **Wrong password:** xpra server never sends an error — it re-sends `challenge`
  forever until its 10s hello timeout. `client.ts` counts challenges; 2nd one =
  auth failed.
- **Fragmented packets:** in `protocol.ts drain()`, if the body isn't fully
  buffered yet (`takeBytes` returns null) you must NOT clear `this.header` —
  return and wait for more data. Clearing it desyncs the stream.
- **WebCrypto (`crypto.subtle`) AND WebCodecs (`VideoDecoder`) require a
  secure context.** Over plain `http://<lan-ip>:5173` from a phone, auth
  breaks and h264 caps are never sent. Dev setup now covers this: vite runs
  HTTPS (self-signed, `@vitejs/plugin-basic-ssl`) and proxies `/xpra` →
  `ws://localhost:10000`, so app + WebSocket share one https origin
  (no mixed content). Phone: `https://<wg-or-lan-ip>:5173`, accept the cert,
  connection form: port 5173, SSL on, WS path `/xpra`. (localhost always
  counts as secure.)
- **Compression flags** (level byte): 0x10 lz4, 0x20 lzo, 0x40 brotli, else
  zlib. We advertise only zlib and fail loudly on others. Server honors
  `compression_level: 1` from hello caps — most packets arrive with 0x08/0x00
  (no compression) or zlib.
- **Raw packet splicing:** frames with header index>0 carry one raw binary blob
  stored at `rawPackets[index]`; it's spliced into the next index-0 packet's
  array at that position. That's how draw pixel data and other binary payloads travel.
- TS6 + DOM lib: WebCrypto args need `as Uint8Array<ArrayBuffer>` casts.
- **Digest selection:** we offer `["hmac+sha256","xor"]`. Server's
  `choose_digest` prefers strongest match → `hmac+sha256` (salt digest too).
  Don't add md5/sha1/384/512 unless you also handle them in crypto.ts.
- **Chrome VideoDecoder requires a key frame after `flush()`.** Per-frame
  flush in the h264 path rejects every P frame ("A key frame is required
  after configure() or flush()", verified Chrome 145 headless). Stream:
  `decode()` per frame, paint from output callback, flush only at stream
  end. See docs/ARCHITECTURE.md "h264 video".

## Milestones

- [x] **M1** scaffold (Vite + Svelte 5 runes + TS), Home connection-list CRUD in localStorage, hash router
- [x] **M2** protocol port + challenge auth + ping RTT — verified against live server (Node smoke test OK; wrong-password path handled)
- [x] **M3** draw pipeline: `new-window`/`desktop_size`/`window-move-resize` handling, canvas renderer (rgb32/jpeg/png/webp/scroll), `damage-sequence` acks — porting `Window.js do_paint` + `Client.js _process_draw_queue`
- [x] **M4** input: pointer (`button-action`, `pointer-position`) + keyboard (`key-action`, Keycodes.js port) + portrait layout with persistent keyboard
- [x] **M5** landscape split layout (left/right control panels around viewport, zoom/pan)
- [x] **M6** shortcut bar, modes (nav/dev/edit), user macros
- [x] **M7** perf pass: over-decode avoidance, request_redraw batching, FPS/decode latency telemetry
- [x] **M8** quality presets (saver/balanced/lossless → hello caps) + h264 video decode via WebCodecs
  (wire format verified live + headless-browser replay test; see ARCHITECTURE.md "h264 video").
  `tests/h264probe.ts` captures/inspects h264 draw packets from a live server (H264_CAPTURE=...json).

## Current file map

```
src/lib/xpra/   bencode.ts protocol.ts crypto.ts client.ts renderer.ts keycodes.ts   # protocol core & renderer & keycodes
src/lib/        storage.ts (connections CRUD) macros.ts (modes/custom macros) router.ts (hash)
src/components/ VirtualKeyboard.svelte LandscapeControls.svelte ShortcutBar.svelte
src/views/      Home.svelte (list + bottom-sheet form) Session.svelte (remote canvas, pointer/touch input, split layouts, modes)
tests/          bencode.test.ts (unit) smoke.ts (live-server integration)
docs/           VISION.md ARCHITECTURE.md
```

The Session view is intentionally a debug/status surface (state badge, RTT,
server caps summary, packet log) until M3 renders pixels. The packet log is
the primary M3/M4 instrumentation — keep it working.
