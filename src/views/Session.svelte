<script lang="ts">
  import { onMount } from 'svelte'
  import { XpraClient, type ClientState, type WindowState, type CursorInfo } from '../lib/xpra/client'
  import { XpraRenderer, type RenderStats } from '../lib/xpra/renderer'
  import { asStr, type BencodeValue } from '../lib/xpra/bencode'
  import { translateKeyEvent } from '../lib/xpra/keycodes'
  import type { MacroItem } from '../lib/macros'
  import { connections } from '../lib/storage'
  import { navigate } from '../lib/router'
  import { subscribePwa, promptInstall } from '../lib/pwa'
  import VirtualKeyboard from '../components/VirtualKeyboard.svelte'
  import LandscapeLeft from '../components/LandscapeLeft.svelte'
  import LandscapeRight from '../components/LandscapeRight.svelte'
  import ShortcutBar from '../components/ShortcutBar.svelte'
  import VoiceInputModal from '../components/VoiceInputModal.svelte'

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
  let showSettings = $state(false)
  let showVoiceModal = $state(false)
  let installable = $state(false)
  let isLandscape = $state(false)
  let forceLandscape = $state(false)
  let isFullscreen = $state(false)
  let hideTopBar = $state(false)
  let isTouchLocked = $state(false)
  let requestingRes = $state<string | null>(null)

  function toggleTouchLock() {
    isTouchLocked = !isTouchLocked
  }

  // Mouse Input Mode: 'trackpad' (relative dragging cursor) vs 'direct' (absolute touch)
  let mouseMode = $state<'trackpad' | 'direct'>('trackpad')
  let cursorPos = $state<[number, number]>([640, 360])
  let isMouseDown = $state(false)
  let isDragLocked = $state(false)
  let activeCursor = $state<CursorInfo | null>(null)

  // Shared Landscape Split-Keyboard Modifier and Symbol States
  let lsSymbols = $state(false)
  let lsCtrlState = $state<'off' | 'latched' | 'locked'>('off')
  let lsAltState = $state<'off' | 'latched' | 'locked'>('off')
  let lsShiftState = $state<'off' | 'latched' | 'locked'>('off')
  let lsMetaState = $state<'off' | 'latched' | 'locked'>('off')

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

    // Two-finger gesture: Pinch zoom OR mouse wheel scroll
    if (activePointers.size === 2) {
      const twoState = getTwoFingerState()
      if (twoState) {
        // 1. Pinch zoom if distance changed noticeably
        if (initialPinchDist > 10 && Math.abs(twoState.dist - initialPinchDist) > 12) {
          const factor = twoState.dist / initialPinchDist
          zoomLevel = Math.max(1.0, Math.min(4.0, Math.round(initialZoom * factor * 100) / 100))
          isZoomFit = zoomLevel === 1.0
        }
        // 2. Two-finger vertical swipe triggers mouse wheel scroll
        else if (prevTwoFingerMid) {
          const dMidY = twoState.mid.y - prevTwoFingerMid.y
          if (Math.abs(dMidY) > 8) {
            sendScroll(dMidY < 0)
          }
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
      // Trackpad Mode (Single finger = move desktop cursor)
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

        // Deadzone Edge Panning: Viewport stays 100% STATIC until cursor reaches outer edges
        if (zoomLevel > 1.0 && viewportEl && canvasEl) {
          const cRect = canvasEl.getBoundingClientRect()
          const vRect = viewportEl.getBoundingClientRect()

          // Horizontal deadzone panning
          if (cRect.width > vRect.width + 4) {
            const maxPanX = ((cRect.width - vRect.width) / 2) / zoomLevel
            const curScreenX = cRect.left - vRect.left + (newX / (desktopRes[0] || 1)) * cRect.width
            const leftDeadzone = vRect.width * 0.12
            const rightDeadzone = vRect.width * 0.88

            if (curScreenX < leftDeadzone) {
              const push = (leftDeadzone - curScreenX) / zoomLevel
              panX = Math.min(maxPanX, panX + push)
            } else if (curScreenX > rightDeadzone) {
              const push = (curScreenX - rightDeadzone) / zoomLevel
              panX = Math.max(-maxPanX, panX - push)
            }
          } else {
            panX = 0
          }

          // Vertical deadzone panning
          if (cRect.height > vRect.height + 4) {
            const maxPanY = ((cRect.height - vRect.height) / 2) / zoomLevel
            const curScreenY = cRect.top - vRect.top + (newY / (desktopRes[1] || 1)) * cRect.height
            const topDeadzone = vRect.height * 0.12
            const bottomDeadzone = vRect.height * 0.88

            if (curScreenY < topDeadzone) {
              const push = (topDeadzone - curScreenY) / zoomLevel
              panY = Math.min(maxPanY, panY + push)
            } else if (curScreenY > bottomDeadzone) {
              const push = (curScreenY - bottomDeadzone) / zoomLevel
              panY = Math.max(-maxPanY, panY - push)
            }
          } else {
            panY = 0
          }
        } else {
          panX = 0
          panY = 0
        }

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

  function sendScroll(up: boolean) {
    if (!client || status !== 'connected') return
    const btn = up ? 4 : 5
    const [x, y] = cursorPos
    client.sendButtonAction(btn, true, x, y)
    client.sendButtonAction(btn, false, x, y)
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
      client.sendText(macro.text)
    }
  }

  function handleVoiceSend(text: string, mode: 'paste' | 'type') {
    if (!client || status !== 'connected') return
    if (mode === 'paste') {
      client.pasteTextToRemote(text)
    } else {
      client.sendText(text, false)
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

  function changeResolution(w: number, h: number) {
    if (!client || status !== 'connected') return
    requestingRes = `${w}×${h}`
    client.sendDesktopSize(w, h)
    setTimeout(() => {
      if (requestingRes === `${w}×${h}`) requestingRes = null
    }, 3000)
  }

  function matchViewportResolution() {
    if (!viewportEl || !client || status !== 'connected') return
    const rect = viewportEl.getBoundingClientRect()
    const w = Math.max(640, Math.round(rect.width * (window.devicePixelRatio || 1)))
    const h = Math.max(480, Math.round(rect.height * (window.devicePixelRatio || 1)))
    changeResolution(w, h)
  }

  onMount(() => {
    if (!conn) {
      navigate('#/')
      return
    }

    if (conn.resolution) {
      desktopRes = conn.resolution
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
        requestingRes = null
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
      const reqW = drawPacket.x + drawPacket.w
      const reqH = drawPacket.y + drawPacket.h
      if (reqW > desktopRes[0] || reqH > desktopRes[1]) {
        desktopRes = [Math.max(desktopRes[0], reqW), Math.max(desktopRes[1], reqH)]
        renderer?.resize(desktopRes[0], desktopRes[1])
      }
      renderer?.queueDraw(drawPacket, done)
    }
    client.events.packet = (name, packet) => {
      packetCount++
      log = [{ name: fmtPacket(packet), size: 0 }, ...log].slice(0, 40)
    }
    client.events.cursor = (cur) => {
      activeCursor = cur
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

    const unsubPwa = subscribePwa((can) => {
      installable = can
    })

    return () => {
      unsubPwa()
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
    }
  })

  let badge = $derived(
    status === 'connected' ? 'connected' : status === 'error' || status === 'closed' ? status : 'connecting',
  )
</script>

<main class="session {isLandscape ? 'landscape' : 'portrait'} {hideTopBar ? 'immersive' : ''}">
  {#if !isLandscape && !hideTopBar}
    <header class="clean-header">
      <button class="icon" aria-label="Back" onclick={() => navigate('#/')}>‹</button>
      <div class="title">
        <strong>{conn?.name ?? '…'}</strong>
        <span class="muted mono">{conn ? `${conn.ssl ? 'wss' : 'ws'}://${conn.host}:${conn.port}` : ''}</span>
      </div>

      <button class="header-btn" onclick={toggleFullscreen} title="Toggle Fullscreen">
        {isFullscreen ? '⛶ Off' : '⛶'}
      </button>
      <button
        class="header-btn {isTouchLocked ? 'active' : ''}"
        onclick={toggleTouchLock}
        title="Touch / Pocket Lock"
      >
        🔒
      </button>
      <button
        class="header-btn {showSettings ? 'active' : ''}"
        onclick={() => (showSettings = !showSettings)}
        title="Settings"
      >
        ⚙️
      </button>
      <span class="badge {badge}">{status}</span>
    </header>

    {#if detail && (status === 'error' || status === 'closed')}
      <p class="detail {status}">{detail}</p>
    {/if}

    <!-- Shortcut Bar with Nav/Dev/Edit Modes -->
    <ShortcutBar onExecute={handleExecuteMacro} />
  {:else if !isLandscape}
    <!-- Floating restore bar in immersive mode (Portrait only) -->
    <div class="floating-topbar-pill">
      <button class="pill-btn" onclick={() => (hideTopBar = false)}>▼ Show Bar</button>
      <button class="pill-btn" onclick={toggleFullscreen}>{isFullscreen ? '⛶ Exit' : '⛶'}</button>
      <button class="pill-btn" onclick={toggleTouchLock}>🔒 Lock</button>
      <button class="pill-btn" onclick={() => (showSettings = true)}>⚙️</button>
    </div>
  {/if}

  {#if isLandscape}
    <!-- Landscape 3-Column Split Layout: Left Keyboard | Center Screen (100% Height) | Right Keyboard -->
    <div class="landscape-split">
      <LandscapeLeft
        onKeyPress={handleVirtualKeyPress}
        onMouseButton={handleLandscapeMouseButton}
        onToggleDragLock={toggleDragLock}
        {isDragLocked}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onBack={() => navigate('#/')}
        onToggleLock={toggleTouchLock}
        bind:isSymbols={lsSymbols}
        bind:ctrlState={lsCtrlState}
        bind:altState={lsAltState}
        bind:shiftState={lsShiftState}
        bind:metaState={lsMetaState}
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
              style:cursor={activeCursor?.dataUrl ? `url("${activeCursor.dataUrl}") ${activeCursor.xhot} ${activeCursor.yhot}, auto` : 'default'}
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
            style:transform="translate({cursorScreen.x - (activeCursor ? activeCursor.xhot : 0)}px, {cursorScreen.y - (activeCursor ? activeCursor.yhot : 0)}px)"
          >
            {#if activeCursor?.dataUrl}
              <img
                src={activeCursor.dataUrl}
                alt="cursor"
                class="cursor-img"
                style:width="{activeCursor.w || 24}px"
                style:height="{activeCursor.h || 24}px"
              />
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2L19 10L11 12L9 20L3 2Z" fill="#ffffff" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
              </svg>
            {/if}
          </div>
        {/if}

        {#if status !== 'connected'}
          <div class="overlay">
            <span class="muted">{status === 'connecting' ? 'Connecting to Xpra…' : status === 'authenticating' ? 'Authenticating…' : detail || status}</span>
          </div>
        {/if}
      </section>

      <LandscapeRight
        onKeyPress={handleVirtualKeyPress}
        onMouseButton={handleLandscapeMouseButton}
        onZoomFit={handleZoomFitToggle}
        {isZoomFit}
        onVoiceInput={() => (showVoiceModal = true)}
        onToggleFullscreen={toggleFullscreen}
        {isFullscreen}
        onOpenSettings={() => (showSettings = true)}
        onToggleLock={toggleTouchLock}
        bind:isSymbols={lsSymbols}
        bind:ctrlState={lsCtrlState}
        bind:altState={lsAltState}
        bind:shiftState={lsShiftState}
        bind:metaState={lsMetaState}
      />
    </div>
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
            style:cursor={activeCursor?.dataUrl ? `url("${activeCursor.dataUrl}") ${activeCursor.xhot} ${activeCursor.yhot}, auto` : 'default'}
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
          style:transform="translate({cursorScreen.x - (activeCursor ? activeCursor.xhot : 0)}px, {cursorScreen.y - (activeCursor ? activeCursor.yhot : 0)}px)"
        >
          {#if activeCursor?.dataUrl}
            <img
              src={activeCursor.dataUrl}
              alt="cursor"
              class="cursor-img"
              style:width="{activeCursor.w || 24}px"
              style:height="{activeCursor.h || 24}px"
            />
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 2L19 10L11 12L9 20L3 2Z" fill="#ffffff" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
          {/if}
        </div>
      {/if}

      {#if status !== 'connected'}
        <div class="overlay">
          <span class="muted">{status === 'connecting' ? 'Connecting to Xpra…' : status === 'authenticating' ? 'Authenticating…' : detail || status}</span>
        </div>
      {/if}
    </section>

    <!-- Quick Mouse & Scroll Actions Bar for Portrait Mode -->
    {#if mouseMode === 'trackpad'}
      <div class="trackpad-actions-bar">
        <button class="tbtn {isDragLocked ? 'active' : ''}" onclick={toggleDragLock}>
          {isDragLocked ? '🔒 Hold Drag' : '✋ Drag'}
        </button>
        <button class="tbtn" onclick={() => sendClick(1)}>Left</button>
        <button class="tbtn" onclick={() => sendClick(3)}>Right</button>
        <button class="tbtn {showKbd ? 'active' : ''}" onclick={() => (showKbd = !showKbd)} title="Toggle Keyboard">
          ⌨ Kbd
        </button>
        <button class="tbtn voice-tbtn" onclick={() => (showVoiceModal = true)} title="Voice Input">
          🎙️
        </button>
        <button class="tbtn scroll-btn" onclick={() => sendScroll(true)} title="Scroll Up">▲ Scroll</button>
        <button class="tbtn scroll-btn" onclick={() => sendScroll(false)} title="Scroll Down">▼ Scroll</button>
      </div>
    {/if}

    {#if showKbd}
      <section class="keyboard-container">
        <VirtualKeyboard
          onKeyPress={handleVirtualKeyPress}
          onKeyAction={handleVirtualKeyAction}
          onVoiceInput={() => (showVoiceModal = true)}
        />
      </section>
    {/if}
  {/if}

  <!-- Settings & Display Modal -->
  {#if showSettings}
    <div
      class="scrim"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.target === e.currentTarget && (showSettings = false)}
      onkeydown={(e) => e.key === 'Escape' && (showSettings = false)}
    >
      <div class="sheet settings-sheet">
        <div class="sheet-header">
          <h2>Session Settings</h2>
          <button class="icon close-btn" aria-label="Close" onclick={() => (showSettings = false)}>✕</button>
        </div>

        <div class="setting-section">
          <h3>Display & Layout</h3>
          <div class="btn-group">
            <button
              class="setting-btn {forceLandscape ? 'active' : ''}"
              onclick={toggleForceLandscape}
            >
              🔄 {isLandscape ? 'Switch to Portrait' : 'Force Landscape'}
            </button>
            <button
              class="setting-btn"
              onclick={() => {
                hideTopBar = true
                showSettings = false
              }}
            >
              ▲ Hide Bars (Immersive)
            </button>
          </div>

          <div class="zoom-controls-row">
            <span class="muted">Zoom Level:</span>
            <div class="zoom-group">
              <button class="setting-btn" onclick={handleZoomOut}>−</button>
              <button class="setting-btn {isZoomFit ? 'active' : ''}" onclick={handleZoomFitToggle}>
                {isZoomFit ? 'Fit (100%)' : `${Math.round(zoomLevel * 100)}%`}
              </button>
              <button class="setting-btn" onclick={handleZoomIn}>+</button>
            </div>
          </div>

          <div class="btn-group" style="margin-top: 4px;">
            <button
              class="setting-btn {isZoomFit ? 'active' : ''}"
              onclick={() => { isZoomFit = true; zoomLevel = 1.0; panX = 0; panY = 0; }}
            >
              Fit Screen
            </button>
            <button
              class="setting-btn {!isZoomFit && zoomLevel === 1.35 ? 'active' : ''}"
              onclick={() => { isZoomFit = false; zoomLevel = 1.35; panX = 0; panY = 0; }}
            >
              Fill Height
            </button>
            <button
              class="setting-btn {!isZoomFit && zoomLevel === 1.5 ? 'active' : ''}"
              onclick={() => { isZoomFit = false; zoomLevel = 1.5; }}
            >
              1.5× Zoom
            </button>
          </div>
        </div>

        <div class="setting-section">
          <h3>Display Resolution</h3>
          <div class="tip-box">
            🖥️ Host Screen: <strong>{desktopRes[0]} × {desktopRes[1]}</strong>
            {#if requestingRes}
              <span class="muted" style="display:block;margin-top:2px;color:#90cdf4;font-weight:600;">
                ⏳ Requesting {requestingRes} from server…
              </span>
            {:else if serverInfo.shadow}
              <span class="muted" style="display:block;margin-top:2px;font-size:11px;">
                (Shadow session mirrors your physical PC monitor :0. Hardware monitors cannot be resized remotely.)
              </span>
            {/if}
          </div>

          <div class="btn-group" style="margin-top: 6px; flex-wrap: wrap;">
            <button
              class="setting-btn {desktopRes[0] === 1280 && desktopRes[1] === 1024 ? 'active' : ''}"
              onclick={() => changeResolution(1280, 1024)}
            >
              1280 × 1024 (5:4)
            </button>
            <button
              class="setting-btn {desktopRes[0] === 1024 && desktopRes[1] === 768 ? 'active' : ''}"
              onclick={() => changeResolution(1024, 768)}
            >
              1024 × 768 (4:3)
            </button>
            <button
              class="setting-btn {desktopRes[0] === 1200 && desktopRes[1] === 750 ? 'active' : ''}"
              onclick={() => changeResolution(1200, 750)}
            >
              1200 × 750
            </button>
            <button
              class="setting-btn {desktopRes[0] === 1280 && desktopRes[1] === 720 ? 'active' : ''}"
              onclick={() => changeResolution(1280, 720)}
            >
              1280 × 720
            </button>
            <button
              class="setting-btn {desktopRes[0] === 1920 && desktopRes[1] === 1080 ? 'active' : ''}"
              onclick={() => changeResolution(1920, 1080)}
            >
              1920 × 1080
            </button>
          </div>
          <button
            class="setting-btn"
            style="margin-top: 4px;"
            onclick={matchViewportResolution}
          >
            📱 Request Viewport Resolution
          </button>
        </div>

        <div class="setting-section">
          <h3>Input Mode</h3>
          <div class="btn-group">
            <button
              class="setting-btn {mouseMode === 'trackpad' ? 'active' : ''}"
              onclick={() => (mouseMode = 'trackpad')}
            >
              🖱️ Trackpad (Relative)
            </button>
            <button
              class="setting-btn {mouseMode === 'direct' ? 'active' : ''}"
              onclick={() => (mouseMode = 'direct')}
            >
              👆 Direct Touch (Absolute)
            </button>
          </div>
        </div>

        <div class="setting-section">
          <h3>Diagnostics & Stats</h3>
          <div class="btn-group">
            <button
              class="setting-btn {showDebug ? 'active' : ''}"
              onclick={() => (showDebug = !showDebug)}
            >
              {showDebug ? 'Hide Live Stats' : 'Show Live Stats Overlay'}
            </button>
          </div>
          <div class="info-grid">
            <div><span class="muted">FPS:</span> <strong>{renderStats.fps}</strong></div>
            <div><span class="muted">RTT:</span> <strong>{rtt === null ? '—' : `${rtt} ms`}</strong></div>
            <div><span class="muted">Resolution:</span> <strong>{desktopRes[0]}×{desktopRes[1]}</strong></div>
            <div><span class="muted">Display:</span> <strong>{serverInfo.display || ':0'}</strong></div>
          </div>
        </div>

        {#if installable}
          <div class="setting-section">
            <h3>PWA App</h3>
            <button class="setting-btn" style="background:#1a2332;border-color:#2b6cb0;color:#90cdf4" onclick={promptInstall}>
              📲 Install rem App to Home Screen
            </button>
          </div>
        {/if}

        <div class="sheet-actions">
          <button type="button" class="btn danger-btn" onclick={() => navigate('#/')}>
            Disconnect
          </button>
          <button type="button" class="btn primary-btn" onclick={() => (showSettings = false)}>
            Done
          </button>
        </div>
      </div>
    </div>
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

  <VoiceInputModal
    open={showVoiceModal}
    onSend={handleVoiceSend}
    onClose={() => (showVoiceModal = false)}
  />

  {#if isTouchLocked}
    <!-- Touch / Pocket Lock Overlay (blocks all touches to the underlying session) -->
    <div
      class="touch-lock-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Touch Screen Locked"
      tabindex="-1"
    >
      <div class="lock-card">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">Touch Screen Locked</div>
        <div class="lock-sub">Pocket protection active • All touches blocked</div>
        <button
          type="button"
          class="unlock-btn"
          onclick={() => (isTouchLocked = false)}
        >
          🔓 Tap to Unlock
        </button>
      </div>
    </div>
  {/if}
</main>

<style>
  .session {
    display: flex;
    flex-direction: column;
    height: 100%;
    margin: 0 auto;
    padding: 4px;
    gap: 4px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .session.portrait {
    max-width: 600px;
    padding: 4px;
    gap: 4px;
  }
  .session.landscape {
    max-width: 100%;
    width: 100vw;
    height: 100vh;
    padding: 0;
    gap: 0;
  }
  .session.immersive {
    padding: 0;
    gap: 0;
    max-width: 100%;
  }
  header.clean-header {
    display: flex;
    align-items: center;
    gap: 6px;
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
    background: transparent;
    border: none;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 6px;
  }
  .header-btn {
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 6px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .header-btn.active {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .badge.connected {
    background: rgba(56, 161, 105, 0.15);
    color: var(--ok);
  }
  .badge.connecting,
  .badge.authenticating {
    background: rgba(214, 158, 46, 0.15);
    color: var(--warn);
  }
  .badge.error,
  .badge.closed {
    background: rgba(229, 62, 62, 0.15);
    color: var(--err);
  }
  .floating-topbar-pill {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    display: flex;
    gap: 4px;
    background: rgba(13, 16, 23, 0.85);
    backdrop-filter: blur(8px);
    padding: 3px 6px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .pill-btn {
    background: #1c222d;
    border: 1px solid #2d3748;
    border-radius: 12px;
    color: var(--text);
    white-space: nowrap;
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
    flex-direction: row;
    flex: 1;
    gap: 2px;
    align-items: stretch;
    min-height: 0;
    width: 100vw;
    height: 100vh;
    position: relative;
    overflow: hidden;
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
  .cursor-img {
    display: block;
    pointer-events: none;
    user-select: none;
    image-rendering: auto;
  }
  .fixed-screen-cursor.dragging svg path {
    fill: #4da3ff;
  }
  .fixed-screen-cursor.dragging .cursor-img {
    filter: drop-shadow(0 0 4px #4da3ff);
  }
  .trackpad-actions-bar {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .tbtn {
    flex: 1;
    height: 32px;
    padding: 0 4px;
    font-size: 11px;
    background: #1c222d;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
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
  .tbtn.voice-tbtn {
    background: #1a2433;
    border-color: #2b6cb0;
    color: #90cdf4;
  }
  .tbtn.scroll-btn {
    background: #1a2332;
    border-color: #2b394e;
    color: #cbd5e0;
  }
  .tbtn.scroll-btn:active {
    background: #2b6cb0;
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

  /* Scrim and Settings Modal Sheet */
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .settings-sheet {
    background: #151921;
    border: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-width: 500px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.8);
  }
  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sheet-header h2 {
    margin: 0;
    font-size: 16px;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }
  .setting-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .setting-section h3 {
    margin: 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--fg-muted);
  }
  .tip-box {
    background: #141a24;
    border: 1px solid #233044;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    color: #e2e8f0;
  }
  .btn-group {
    display: flex;
    gap: 8px;
  }
  .setting-btn {
    flex: 1;
    height: 36px;
    font-size: 12px;
    font-weight: 500;
    background: #1c222d;
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .setting-btn.active {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .zoom-controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1c222d;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .zoom-group {
    display: flex;
    gap: 4px;
  }
  .zoom-group .setting-btn {
    height: 28px;
    padding: 0 10px;
    min-width: 32px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    background: #1c222d;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 12px;
  }
  .sheet-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .danger-btn {
    background: #742a2a;
    color: #fff;
    border: 1px solid #9b2c2c;
    flex: 1;
    height: 38px;
    border-radius: 8px;
  }
  .primary-btn {
    background: #2b6cb0;
    color: #fff;
    border: 1px solid #3182ce;
    flex: 2;
    height: 38px;
    border-radius: 8px;
  }
  .touch-lock-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(5, 7, 10, 0.88);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
    user-select: none;
  }
  .lock-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #111622;
    border: 1px solid #2d3748;
    border-radius: 16px;
    padding: 24px 32px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
    text-align: center;
    gap: 8px;
    max-width: 320px;
  }
  .lock-icon {
    font-size: 44px;
    filter: drop-shadow(0 2px 8px rgba(246, 224, 94, 0.4));
  }
  .lock-title {
    font-size: 16px;
    font-weight: 700;
    color: #f7fafc;
  }
  .lock-sub {
    font-size: 12px;
    color: #a0aec0;
    margin-bottom: 8px;
  }
  .unlock-btn {
    background: #2b6cb0;
    border: 1px solid #4299e1;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 24px;
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(43, 108, 176, 0.4);
    touch-action: manipulation;
  }
  .unlock-btn:active {
    background: #2c5282;
    transform: scale(0.98);
  }
</style>
