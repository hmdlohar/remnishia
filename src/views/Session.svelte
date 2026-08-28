<script lang="ts">
  import { onMount } from 'svelte'
  import { XpraClient, type ClientState, type WindowState } from '../lib/xpra/client'
  import { XpraRenderer, type RenderStats } from '../lib/xpra/renderer'
  import { asStr, type BencodeValue } from '../lib/xpra/bencode'
  import { translateKeyEvent } from '../lib/xpra/keycodes'
  import type { MacroItem } from '../lib/macros'
  import { connections } from '../lib/storage'
  import { navigate } from '../lib/router'
  import VirtualKeyboard from '../components/VirtualKeyboard.svelte'
  import LandscapeControls from '../components/LandscapeControls.svelte'
  import ShortcutBar from '../components/ShortcutBar.svelte'

  let { id }: { id: string } = $props()
  let status = $state<ClientState>('idle')
  let detail = $state('')
  let rtt = $state<number | null>(null)
  let packetCount = $state(0)
  let drawCount = $state(0)
  let desktopRes = $state<[number, number]>([1280, 720])
  let serverInfo = $state<{ version?: string; shadow?: boolean; display?: string }>({})
  let log = $state<{ name: string; size: number }[]>([])
  let showDebug = $state(false)
  let showKbd = $state(false)
  let isLandscape = $state(false)
  let forceLandscape = $state(false)
  let isFullscreen = $state(false)
  let hideTopBar = $state(false)

  // Mouse Input Mode: 'trackpad' (relative dragging cursor) vs 'direct' (absolute touch)
  let mouseMode = $state<'trackpad' | 'direct'>('trackpad')
  let cursorPos = $state<[number, number]>([640, 360])
  let isMouseDown = $state(false)
  let isDragLocked = $state(false)

  let renderStats = $state<RenderStats>({
    fps: 0,
    avgDecodeMs: 0,
    queuedFrames: 0,
    totalPaints: 0,
  })

  // Zoom & Pan state (supported in both Portrait & Landscape)
  let isZoomFit = $state(true)
  let zoomLevel = $state(1.0)
  let panX = $state(0)
  let panY = $state(0)

  let canvasEl: HTMLCanvasElement | null = $state(null)
  let viewportEl: HTMLElement | null = $state(null)
  let client: XpraClient | null = null
  let renderer: XpraRenderer | null = null
  let conn: (typeof $connections)[number] | undefined = $derived($connections.find((c) => c.id === id))

  // Touch tracking state for trackpad & pinch zoom
  let touchStartPos: { x: number; y: number } | null = null
  let touchStartTime = 0
  let touchMoved = false
  let activePointers = new Map<number, { x: number; y: number }>()
  let initialPinchDist = 0
  let initialZoom = 1.0
  let prevTwoFingerMid: { x: number; y: number } | null = null

  // Screen-space cursor position that stays crisp and unscaled when zooming
  let cursorScreen = $state<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false })

  function updateCursorScreen() {
    if (!canvasEl || !viewportEl || status !== 'connected') {
      cursorScreen = { x: 0, y: 0, visible: false }
      return
    }
    const cRect = canvasEl.getBoundingClientRect()
    const vRect = viewportEl.getBoundingClientRect()
    if (cRect.width <= 0 || cRect.height <= 0) {
      cursorScreen = { x: 0, y: 0, visible: false }
      return
    }
    const x = cRect.left - vRect.left + (cursorPos[0] / (desktopRes[0] || 1)) * cRect.width
    const y = cRect.top - vRect.top + (cursorPos[1] / (desktopRes[1] || 1)) * cRect.height
    cursorScreen = { x, y, visible: true }
  }

  $effect(() => {
    // Recompute screen position whenever cursor, zoom, or pan changes
    cursorPos[0]
    cursorPos[1]
    zoomLevel
    panX
    panY
    status
    updateCursorScreen()
  })

  function fmtPacket(packet: BencodeValue[]): string {
    return asStr(packet[0])
  }

  function checkOrientation() {
    if (typeof window !== 'undefined') {
      const physicalLandscape = window.innerWidth > window.innerHeight && window.innerWidth > 600
      isLandscape = forceLandscape || physicalLandscape
    }
  }

  async function toggleForceLandscape() {
    forceLandscape = !forceLandscape
    checkOrientation()

    // Screen Orientation API (works on Android Chrome even if system auto-rotate is locked)
    try {
      const screenAny = screen as unknown as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => Promise<void> } }
      if (screenAny?.orientation) {
        if (forceLandscape) {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen().catch(() => {})
          }
          if (typeof screenAny.orientation.lock === 'function') {
            await screenAny.orientation.lock('landscape').catch(() => {})
          }
        } else {
          if (typeof screenAny.orientation.unlock === 'function') {
            screenAny.orientation.unlock()
          }
        }
      }
    } catch {
      // Ignored if unsupported
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  function getCanvasCoords(e: { clientX: number; clientY: number }): [number, number] {
    if (!canvasEl) return [0, 0]
    const rect = canvasEl.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return [0, 0]
    const scaleX = desktopRes[0] / rect.width
    const scaleY = desktopRes[1] / rect.height
    const x = Math.max(0, Math.min(desktopRes[0] - 1, (e.clientX - rect.left) * scaleX))
    const y = Math.max(0, Math.min(desktopRes[1] - 1, (e.clientY - rect.top) * scaleY))
    return [x, y]
  }

  function getTwoFingerState(): { dist: number; mid: { x: number; y: number } } | null {
    const pts = Array.from(activePointers.values())
    if (pts.length < 2) return null
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
    return { dist, mid }
  }

  function handlePointerDown(e: PointerEvent) {
    if (status !== 'connected' || !client) return
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (canvasEl) {
      canvasEl.setPointerCapture(e.pointerId)
    }

    if (activePointers.size === 2) {
      const state = getTwoFingerState()
      if (state) {
        initialPinchDist = state.dist
        initialZoom = zoomLevel
        prevTwoFingerMid = state.mid
      }
      touchMoved = true
      return
    }

    if (mouseMode === 'direct' || e.pointerType === 'mouse') {
      const [x, y] = getCanvasCoords(e)
      cursorPos = [x, y]
      const btn = e.button === 0 ? 1 : e.button === 1 ? 2 : e.button === 2 ? 3 : 1
      isMouseDown = true
      client.sendPointerPosition(x, y)
      client.sendButtonAction(btn, true, x, y, [], [btn])
    } else {
      // Trackpad Mode: single finger starts tracking
      if (activePointers.size === 1) {
        touchStartPos = { x: e.clientX, y: e.clientY }
        touchStartTime = performance.now()
        touchMoved = false
      }
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (status !== 'connected' || !client) return
    const prev = activePointers.get(e.pointerId)
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two-finger gesture: Pinch zoom AND Pan viewport cleanly
    if (activePointers.size === 2) {
      const twoState = getTwoFingerState()
      if (twoState) {
        // 1. Pinch zoom if distance changed
        if (initialPinchDist > 10 && Math.abs(twoState.dist - initialPinchDist) > 8) {
          const factor = twoState.dist / initialPinchDist
          zoomLevel = Math.max(1.0, Math.min(4.0, Math.round(initialZoom * factor * 100) / 100))
          isZoomFit = zoomLevel === 1.0
        }

        // 2. Pan viewport with 2-finger drag
        if (prevTwoFingerMid && zoomLevel > 1.0) {
          const dMidX = twoState.mid.x - prevTwoFingerMid.x
          const dMidY = twoState.mid.y - prevTwoFingerMid.y
          panX += dMidX / zoomLevel
          panY += dMidY / zoomLevel
        }
        prevTwoFingerMid = twoState.mid
      }
      return
    }

    if (mouseMode === 'direct' || e.pointerType === 'mouse') {
      const [x, y] = getCanvasCoords(e)
      cursorPos = [x, y]
      const btns = e.buttons ? [e.buttons & 1 ? 1 : e.buttons & 2 ? 3 : e.buttons & 4 ? 2 : 1] : []
      client.sendPointerPosition(x, y, [], btns)
    } else {
      // Trackpad Mode (Single finger = STRICTLY move desktop cursor)
      if (activePointers.size === 1 && prev) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        const dist = Math.hypot(dx, dy)
        if (dist > 1.5) {
          touchMoved = true
        }

        // Fast responsive trackpad speed with dynamic velocity acceleration
        const speedBoost = Math.min(1.8, 1 + dist * 0.035)
        const sensitivity = 2.0 * speedBoost
        const newX = Math.max(0, Math.min(desktopRes[0] - 1, Math.round(cursorPos[0] + dx * sensitivity)))
        const newY = Math.max(0, Math.min(desktopRes[1] - 1, Math.round(cursorPos[1] + dy * sensitivity)))
        cursorPos = [newX, newY]

        const btns = isDragLocked || isMouseDown ? [1] : []
        client.sendPointerPosition(newX, newY, [], btns)
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (status !== 'connected' || !client) return
    const wasMultiTouch = activePointers.size >= 2
    activePointers.delete(e.pointerId)
    if (activePointers.size < 2) {
      prevTwoFingerMid = null
    }

    if (canvasEl && canvasEl.hasPointerCapture(e.pointerId)) {
      canvasEl.releasePointerCapture(e.pointerId)
    }

    if (mouseMode === 'direct' || e.pointerType === 'mouse') {
      const [x, y] = getCanvasCoords(e)
      cursorPos = [x, y]
      const btn = e.button === 0 ? 1 : e.button === 1 ? 2 : e.button === 2 ? 3 : 1
      isMouseDown = false
      client.sendButtonAction(btn, false, x, y)
    } else {
      // Trackpad Mode Tap Detection
      const duration = performance.now() - touchStartTime
      if (!touchMoved && duration < 280) {
        if (wasMultiTouch) {
          // Two-finger tap = Right Click
          sendClick(3)
        } else {
          // Single-finger tap = Left Click
          sendClick(1)
        }
      }
    }
  }

  function sendClick(btn: number) {
    if (!client || status !== 'connected') return
    const [x, y] = cursorPos
    client.sendPointerPosition(x, y)
    client.sendButtonAction(btn, true, x, y, [], [btn])
    setTimeout(() => {
      client?.sendButtonAction(btn, false, x, y)
    }, 40)
  }

  function toggleDragLock() {
    if (!client || status !== 'connected') return
    isDragLocked = !isDragLocked
    const [x, y] = cursorPos
    client.sendButtonAction(1, isDragLocked, x, y, [], isDragLocked ? [1] : [])
  }

  function handleWheel(e: WheelEvent) {
    if (status !== 'connected' || !client) return
    e.preventDefault()
    if (e.ctrlKey) {
      // Zoom with Ctrl + Wheel
      if (e.deltaY < 0) handleZoomIn()
      else handleZoomOut()
      return
    }
    const [x, y] = mouseMode === 'trackpad' ? cursorPos : getCanvasCoords(e)
    const btn = e.deltaY > 0 ? 5 : 4
    client.sendButtonAction(btn, true, x, y)
    client.sendButtonAction(btn, false, x, y)
  }

  function handleVirtualKeyPress(keyname: string, modifiers: string[], keyval = 0, str = '') {
    if (!client || status !== 'connected') return
    client.sendKeyPress(keyname, modifiers, keyval, str)
  }

  function handleVirtualKeyAction(keyname: string, pressed: boolean, modifiers: string[], keyval = 0, str = '') {
    if (!client || status !== 'connected') return
    client.sendKeyAction(keyname, pressed, modifiers, keyval, str)
  }

  function handleLandscapeMouseButton(btn: number) {
    sendClick(btn)
  }

  function handleExecuteMacro(macro: MacroItem) {
    if (!client || status !== 'connected') return
    if (macro.type === 'key' && macro.key) {
      client.sendKeyPress(macro.key)
    } else if (macro.type === 'combo' && macro.key) {
      client.sendKeyPress(macro.key, macro.modifiers || [])
    } else if (macro.type === 'text' && macro.text) {
      for (const ch of macro.text) {
        if (ch === '\n') {
          client.sendKeyPress('Return')
        } else {
          client.sendKeyPress(ch)
        }
      }
    }
  }

  function handleZoomFitToggle() {
    isZoomFit = !isZoomFit
    if (isZoomFit) {
      zoomLevel = 1.0
      panX = 0
      panY = 0
    } else {
      zoomLevel = 1.5
    }
  }

  function handleZoomIn() {
    isZoomFit = false
    zoomLevel = Math.min(4.0, Math.round((zoomLevel + 0.25) * 100) / 100)
  }

  function handleZoomOut() {
    zoomLevel = Math.max(1.0, Math.round((zoomLevel - 0.25) * 100) / 100)
    if (zoomLevel === 1.0) {
      isZoomFit = true
      panX = 0
      panY = 0
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (status !== 'connected' || !client) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    e.preventDefault()
    const info = translateKeyEvent(e)
    const mods: string[] = []
    if (e.ctrlKey) mods.push('control')
    if (e.altKey) mods.push('alt')
    if (e.shiftKey) mods.push('shift')
    if (e.metaKey) mods.push('meta')
    client.sendKeyAction(info.keyname, true, mods, info.keyval, info.str, info.keycode)
  }

  function handleWindowKeyUp(e: KeyboardEvent) {
    if (status !== 'connected' || !client) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    e.preventDefault()
    const info = translateKeyEvent(e)
    const mods: string[] = []
    if (e.ctrlKey) mods.push('control')
    if (e.altKey) mods.push('alt')
    if (e.shiftKey) mods.push('shift')
    if (e.metaKey) mods.push('meta')
    client.sendKeyAction(info.keyname, false, mods, info.keyval, info.str, info.keycode)
  }

  onMount(() => {
    if (!conn) {
      navigate('#/')
      return
    }

    checkOrientation()
    window.addEventListener('resize', checkOrientation)

    const onFullscreenChange = () => {
      isFullscreen = Boolean(document.fullscreenElement)
      setTimeout(updateCursorScreen, 100)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)

    renderer = new XpraRenderer()
    renderer.onStats = (s) => (renderStats = s)

    if (canvasEl) {
      renderer.attachCanvas(canvasEl)
      renderer.resize(desktopRes[0], desktopRes[1])
    }

    client = new XpraClient()
    client.events.state = (s, d) => {
      status = s
      detail = d ?? ''
    }
    client.events.serverHello = (caps) => {
      serverInfo = {
        version: asStr(caps.version),
        shadow: caps.shadow === 1,
        display: asStr(caps.display),
      }
    }
    client.events.ping = (ms) => (rtt = ms)
    client.events.desktopSize = (w, h) => {
      if (w > 0 && h > 0) {
        desktopRes = [w, h]
        renderer?.resize(w, h)
        cursorPos = [Math.round(w / 2), Math.round(h / 2)]
      }
    }
    client.events.window = (action, win: WindowState) => {
      if ((action === 'new' || action === 'move_resize') && win.w > 0 && win.h > 0) {
        desktopRes = [win.w, win.h]
        renderer?.resize(win.w, win.h)
      }
    }
    client.events.draw = (drawPacket, done) => {
      drawCount++
      renderer?.queueDraw(drawPacket, done)
    }
    client.events.packet = (name, packet) => {
      packetCount++
      log = [{ name: fmtPacket(packet), size: 0 }, ...log].slice(0, 40)
    }

    client.connect({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      ssl: conn.ssl,
      desktopSize: desktopRes,
    })

    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('keyup', handleWindowKeyUp)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('resize', checkOrientation)
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('keyup', handleWindowKeyUp)
      renderer?.detachCanvas()
      client?.disconnect()
    }
  })

  $effect(() => {
    if (canvasEl && renderer) {
      renderer.attachCanvas(canvasEl)
      renderer.resize(desktopRes[0], desktopRes[1])
    }
  })

  let badge = $derived(
    status === 'connected' ? 'connected' : status === 'error' || status === 'closed' ? status : 'connecting',
  )
</script>

<main class="session {isLandscape ? 'landscape' : 'portrait'} {hideTopBar ? 'immersive' : ''}">
  {#if !hideTopBar}
    <header>
      <button class="icon" aria-label="Back" onclick={() => navigate('#/')}>‹</button>
      <div class="title">
        <strong>{conn?.name ?? '…'}</strong>
        <span class="muted mono">{conn ? `${conn.ssl ? 'wss' : 'ws'}://${conn.host}:${conn.port}` : ''}</span>
      </div>

      <!-- Quick Zoom Strip -->
      <div class="zoom-strip">
        <button class="zoom-btn" onclick={handleZoomOut} title="Zoom Out">−</button>
        <button class="zoom-btn mode-btn {isZoomFit ? 'fit' : 'zoomed'}" onclick={handleZoomFitToggle}>
          {isZoomFit ? 'Fit' : `${Math.round(zoomLevel * 100)}%`}
        </button>
        <button class="zoom-btn" onclick={handleZoomIn} title="Zoom In">+</button>
      </div>

      <!-- Force Landscape / Rotate Screen Button -->
      <button
        class="toggle-btn {forceLandscape ? 'active' : ''}"
        onclick={toggleForceLandscape}
        title="Toggle Landscape / Rotate"
      >
        🔄 {isLandscape ? 'Portrait' : 'Landscape'}
      </button>

      <button
        class="toggle-btn mode-btn {mouseMode === 'trackpad' ? 'active' : ''}"
        onclick={() => (mouseMode = mouseMode === 'trackpad' ? 'direct' : 'trackpad')}
        title="Toggle Mouse Mode"
      >
        {mouseMode === 'trackpad' ? '🖱️ Track' : '👆 Touch'}
      </button>
      <button class="toggle-btn" onclick={toggleFullscreen} title="Toggle Fullscreen">
        {isFullscreen ? '⛶ Off' : '⛶'}
      </button>
      <button class="toggle-btn" onclick={() => (hideTopBar = true)} title="Hide Topbar">
        ▲
      </button>
      <button class="toggle-btn {showKbd ? 'active' : ''}" onclick={() => (showKbd = !showKbd)} title="Toggle Keyboard">
        ⌨
      </button>
      <button class="toggle-btn {showDebug ? 'active' : ''}" onclick={() => (showDebug = !showDebug)}>
        Stats
      </button>
      <span class="badge {badge}">{status}</span>
    </header>

    {#if detail && (status === 'error' || status === 'closed')}
      <p class="detail {status}">{detail}</p>
    {/if}

    <!-- Shortcut Bar with Nav/Dev/Edit Modes -->
    <ShortcutBar onExecute={handleExecuteMacro} />
  {:else}
    <!-- Floating restore bar in immersive mode -->
    <div class="floating-topbar-pill">
      <button class="pill-btn" onclick={() => (hideTopBar = false)}>▼ Show Bar</button>
      <button class="pill-btn {forceLandscape ? 'active' : ''}" onclick={toggleForceLandscape}>
        🔄 {isLandscape ? 'Port' : 'Land'}
      </button>
      <button class="pill-btn" onclick={handleZoomOut}>−</button>
      <button class="pill-btn" onclick={handleZoomFitToggle}>{isZoomFit ? 'Fit' : `${Math.round(zoomLevel * 100)}%`}</button>
      <button class="pill-btn" onclick={handleZoomIn}>+</button>
      <button
        class="pill-btn {mouseMode === 'trackpad' ? 'active' : ''}"
        onclick={() => (mouseMode = mouseMode === 'trackpad' ? 'direct' : 'trackpad')}
      >
        {mouseMode === 'trackpad' ? '🖱️ Track' : '👆 Touch'}
      </button>
      <button class="pill-btn {isDragLocked ? 'drag-active' : ''}" onclick={toggleDragLock}>
        {isDragLocked ? '🔒 Drag' : '✋ Drag'}
      </button>
      <button class="pill-btn" onclick={() => sendClick(1)}>Left</button>
      <button class="pill-btn" onclick={() => sendClick(3)}>Right</button>
      <button class="pill-btn" onclick={toggleFullscreen}>{isFullscreen ? '⛶ Exit' : '⛶'}</button>
      <button class="pill-btn {showKbd ? 'active' : ''}" onclick={() => (showKbd = !showKbd)}>⌨</button>
    </div>
  {/if}

  {#if isLandscape}
    <!-- Landscape 3-Column Split Layout -->
    <div class="landscape-split">
      <LandscapeControls
        onKeyPress={handleVirtualKeyPress}
        onMouseButton={handleLandscapeMouseButton}
        onToggleKbd={() => (showKbd = !showKbd)}
        onZoomFit={handleZoomFitToggle}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        {isZoomFit}
        {showKbd}
      />

      <section bind:this={viewportEl} class="viewport-container landscape-vp">
        <div
          class="canvas-wrapper"
          style:transform="scale({zoomLevel}) translate({panX}px, {panY}px)"
        >
          <div class="canvas-relative-container">
            <canvas
              bind:this={canvasEl}
              class="remote-canvas"
              onpointerdown={handlePointerDown}
              onpointermove={handlePointerMove}
              onpointerup={handlePointerUp}
              onpointercancel={handlePointerUp}
              onwheel={handleWheel}
              oncontextmenu={(e) => e.preventDefault()}
            ></canvas>
          </div>
        </div>

        <!-- Fixed-size sharp screen cursor (not affected by zoom scale) -->
        {#if cursorScreen.visible}
          <div
            class="fixed-screen-cursor {isDragLocked ? 'dragging' : ''}"
            style:transform="translate({cursorScreen.x}px, {cursorScreen.y}px)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 2L19 10L11 12L9 20L3 2Z" fill="#ffffff" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
          </div>
        {/if}

        {#if status !== 'connected'}
          <div class="overlay">
            <span class="muted">{status === 'connecting' ? 'Connecting to Xpra…' : status === 'authenticating' ? 'Authenticating…' : detail || status}</span>
          </div>
        {/if}
      </section>
    </div>

    <!-- Landscape Keyboard Drawer -->
    {#if showKbd}
      <div class="landscape-kbd-drawer">
        <VirtualKeyboard
          onKeyPress={handleVirtualKeyPress}
          onKeyAction={handleVirtualKeyAction}
        />
      </div>
    {/if}
  {:else}
    <!-- Portrait Layout with Zoom & Pan wrapper -->
    <section bind:this={viewportEl} class="viewport-container portrait-vp">
      <div
        class="canvas-wrapper"
        style:transform="scale({zoomLevel}) translate({panX}px, {panY}px)"
      >
        <div class="canvas-relative-container">
          <canvas
            bind:this={canvasEl}
            class="remote-canvas"
            onpointerdown={handlePointerDown}
            onpointermove={handlePointerMove}
            onpointerup={handlePointerUp}
            onpointercancel={handlePointerUp}
            onwheel={handleWheel}
            oncontextmenu={(e) => e.preventDefault()}
          ></canvas>
        </div>
      </div>

      <!-- Fixed-size sharp screen cursor (not affected by zoom scale) -->
      {#if cursorScreen.visible}
        <div
          class="fixed-screen-cursor {isDragLocked ? 'dragging' : ''}"
          style:transform="translate({cursorScreen.x}px, {cursorScreen.y}px)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 2L19 10L11 12L9 20L3 2Z" fill="#ffffff" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </div>
      {/if}

      {#if status !== 'connected'}
        <div class="overlay">
          <span class="muted">{status === 'connecting' ? 'Connecting to Xpra…' : status === 'authenticating' ? 'Authenticating…' : detail || status}</span>
        </div>
      {/if}
    </section>

    <!-- Quick Mouse & Zoom Bar for Portrait Mode -->
    {#if mouseMode === 'trackpad'}
      <div class="trackpad-actions-bar">
        <button class="tbtn {isDragLocked ? 'active' : ''}" onclick={toggleDragLock}>
          {isDragLocked ? '🔒 Hold Drag' : '✋ Drag'}
        </button>
        <button class="tbtn" onclick={() => sendClick(1)}>Left Click</button>
        <button class="tbtn" onclick={() => sendClick(2)}>Mid</button>
        <button class="tbtn" onclick={() => sendClick(3)}>Right Click</button>
      </div>
    {/if}

    {#if showKbd}
      <section class="keyboard-container">
        <VirtualKeyboard
          onKeyPress={handleVirtualKeyPress}
          onKeyAction={handleVirtualKeyAction}
        />
      </section>
    {/if}
  {/if}

  {#if showDebug && !hideTopBar}
    <section class="grid">
      <div>
        <span class="muted">FPS</span>
        <strong>{renderStats.fps} fps</strong>
      </div>
      <div>
        <span class="muted">Zoom</span>
        <strong>{Math.round(zoomLevel * 100)}% {isZoomFit ? '(Fit)' : ''}</strong>
      </div>
      <div>
        <span class="muted">Resolution</span>
        <strong>{desktopRes[0]}×{desktopRes[1]}</strong>
      </div>
      <div>
        <span class="muted">Cursor</span>
        <strong>{cursorPos[0]}, {cursorPos[1]}</strong>
      </div>
    </section>

    <section class="log">
      <h3 class="muted">incoming packets</h3>
      {#each log as p}
        <div class="line mono">{p.name}</div>
      {/each}
    </section>
  {/if}
</main>

<style>
  .session {
    display: flex;
    flex-direction: column;
    height: 100%;
    margin: 0 auto;
    padding: 6px;
    gap: 6px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .session.portrait {
    max-width: 600px;
  }
  .session.landscape {
    max-width: 100%;
    height: 100vh;
  }
  .session.immersive {
    padding: 0;
    gap: 0;
    max-width: 100%;
  }
  header {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .title {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title .mono {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
  .icon {
    width: 32px;
    height: 32px;
    font-size: 18px;
    padding: 0;
  }
  .zoom-strip {
    display: flex;
    gap: 2px;
    background: #161c26;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 2px;
  }
  .zoom-btn {
    height: 24px;
    padding: 0 6px;
    font-size: 11px;
    background: transparent;
    border: none;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .zoom-btn.mode-btn {
    font-family: var(--mono);
    font-size: 10px;
    min-width: 34px;
  }
  .zoom-btn:active {
    background: #2b6cb0;
    border-radius: 4px;
  }
  .toggle-btn {
    font-size: 11px;
    padding: 2px 6px;
    height: 28px;
    background: #1c222d;
    border: 1px solid var(--border);
    color: var(--fg-muted);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
  }
  .toggle-btn.mode-btn {
    font-weight: 500;
  }
  .toggle-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: #232c3b;
  }
  .floating-topbar-pill {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    gap: 3px;
    background: rgba(17, 20, 26, 0.88);
    backdrop-filter: blur(6px);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 3px 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }
  .pill-btn {
    font-size: 11px;
    padding: 2px 7px;
    height: 24px;
    background: #1c222d;
    border: 1px solid #2d3748;
    border-radius: 12px;
    color: var(--text);
    white-space: nowrap;
  }
  .pill-btn.active {
    background: #2b6cb0;
    color: #fff;
  }
  .pill-btn.drag-active {
    background: #9b2c2c;
    border-color: #fc8181;
    color: #fff;
  }
  .detail {
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--panel);
    font-size: 12px;
    flex-shrink: 0;
  }
  .detail.error {
    color: var(--err);
  }
  .landscape-split {
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: stretch;
    min-height: 0;
    position: relative;
  }
  .viewport-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #05070a;
    border-radius: 8px;
    overflow: hidden;
    touch-action: none;
  }
  .portrait-vp {
    flex: 1;
    min-height: 180px;
  }
  .landscape-vp {
    flex: 1;
    min-height: 0;
  }
  .canvas-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    transform-origin: center center;
    transition: transform 0.05s ease-out;
  }
  .canvas-relative-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    max-height: 100%;
  }
  .remote-canvas {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
    cursor: default;
  }
  .fixed-screen-cursor {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 25;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.8));
    will-change: transform;
  }
  .fixed-screen-cursor.dragging svg path {
    fill: #4da3ff;
  }
  .trackpad-actions-bar {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .tbtn {
    flex: 1;
    height: 30px;
    padding: 0 4px;
    font-size: 11px;
    background: #1c222d;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
  }
  .tbtn:active {
    background: #3182ce;
    color: #fff;
  }
  .tbtn.active {
    background: #9b2c2c;
    border-color: #fc8181;
    color: #fff;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
  }
  .landscape-kbd-drawer {
    position: absolute;
    bottom: 8px;
    left: 150px;
    right: 150px;
    z-index: 20;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.7);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 6px;
    flex-shrink: 0;
  }
  .grid > div {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
  }
  .grid span {
    font-size: 11px;
  }
  .log {
    height: 100px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    flex-shrink: 0;
  }
  .log h3 {
    margin: 0 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .line {
    font-size: 11px;
    padding: 1px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .keyboard-container {
    flex-shrink: 0;
    width: 100%;
  }
</style>
