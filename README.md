# rem — mobile remote desktop client

A phone-first web client for remote desktops, built on the
[Xpra](https://xpra.org) protocol. The pitch: don't make the PC fit the
phone — make the interaction model fit the phone. Persistent custom
keyboards, shortcut macros, portrait + landscape split layouts, on top of a
real remote-desktop protocol (not a video stream you have to squint at).

See [`docs/VISION.md`](docs/VISION.md) for the full product thinking,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it works, and
[`AGENTS.md`](AGENTS.md) for contributor/agent working notes.

## Status

| Milestone | What | State |
|---|---|---|
| M1 | scaffold, connection list (localStorage), hash router | done |
| M2 | Xpra wire protocol port, challenge auth, ping RTT — tested against live server | done |
| M3 | canvas draw pipeline (rgb32/jpeg/png/webp/scroll) | done |
| M4 | pointer + keyboard input, portrait layout w/ persistent keyboard | done |
| M5 | landscape split layout (side control panels, zoom/pan) | done |
| M6 | shortcut bar, modes (nav/dev/edit), user macros | done |
| M7 | perf pass: over-decode avoidance, request_redraw batching, live FPS telemetry | done |

Stack: Vite + Svelte 5 (runes) + TypeScript + plain CSS. The protocol layer
(`src/lib/xpra/`) is framework-free and runs in Node too.

---

## Quickstart: Access Directly From Mobile (Plain HTTP)

### 1. Server Side (Remote PC)

Make sure you have Xpra installed (`xpra ≥ 3.x`). To shadow your active Linux desktop:

```bash
xpra shadow --bind-ws=0.0.0.0:10000 :0
```

> If you want password authentication, run:
> ```bash
> xpra shadow --bind-ws=0.0.0.0:10000 --password=yourpassword :0
> ```

*(`:0` is the X display of your running session; check with `echo $DISPLAY`.)*

---

### 2. Client Side (Start Web Client)

Inside this repository, start the Vite development server:

```bash
npm run dev
```

Vite will serve over plain HTTP and output your LAN network address:

```
➜  Local:   http://localhost:5173/
➜  Network: http://<your-pc-ip>:5173/
```

---

### 3. Open on Mobile Phone

1. Connect your phone to the **same Wi-Fi network**.
2. Open your mobile browser and go to `http://<your-pc-ip>:5173/` *(e.g. `http://192.168.0.100:5173/`)*.
3. Tap **"+ Add Connection"**:
   - **Name**: `Desktop`
   - **Host**: `<your-pc-ip>` *(e.g. `192.168.0.100`)*
   - **Port**: `10000`
   - **Password**: *(leave blank if none, or enter your password)*
4. Tap **Connect**!

*(Note: A built-in pure JavaScript SHA-256 / HMAC fallback is included, allowing full challenge authentication to work seamlessly even over plain HTTP on mobile browsers).*

---

## Mobile Features

- **Portrait Mode**: Top-aligned remote desktop viewport + persistent on-screen keyboard with modifier latching/locking (`Ctrl`, `Alt`, `Shift`, `Super`), macro keys, and arrow cluster.
- **Landscape 3-Column Split**: Center zoomable/pannable viewport flanked by thumb controls (Left: D-pad & modifiers; Right: mouse buttons & macro grid).
- **Shortcut Bar**: Mode presets (`Nav`, `Dev`, `Edit`) and custom user command/combo macros stored in `localStorage`.
- **Live Telemetry**: Real-time FPS, decode latency (ms), and ping RTT overlay.

---

## Commands & Tests

```bash
npm run dev      # start development server with LAN host
npm run build    # production build -> dist/
npm run check    # svelte-check — 0 errors / 0 warnings

# Unit tests (bencode codec round-trips)
node_modules/typescript/bin/tsc --ignoreConfig src/lib/xpra/bencode.ts tests/bencode.test.ts \
  --module commonjs --target es2022 --lib es2022,dom --outDir /tmp/opencode/xpra-build --esModuleInterop --strict
node /tmp/opencode/xpra-build/tests/bencode.test.js

# Live server integration smoke test
node_modules/typescript/bin/tsc --ignoreConfig src/lib/xpra/*.ts tests/smoke.ts \
  --module commonjs --target es2022 --lib es2022,dom --outDir /tmp/opencode/xpra-build --esModuleInterop --strict --skipLibCheck
cd /tmp/opencode/xpra-build && NODE_PATH=/media/hyper2/HYPER/projects/node/hmd/rem/node_modules \
  XPRA_HOST=127.0.0.1 XPRA_PORT=10000 XPRA_USER=<u> XPRA_PASS=<p> node tests/smoke.js
```
