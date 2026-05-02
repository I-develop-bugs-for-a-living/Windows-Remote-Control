<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { io, type Socket } from 'socket.io-client'

  import {
    type BridgeHello,
    PROTOCOL_VERSION,
    type AuthEnvelope,
    type ClientToServerEvents,
    type PairResult,
    type ServerToClientEvents,
  } from '@remote-control/shared'

  let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null

  let token = ''
  let pairCode = ''
  let requiresCode = true
  let status = 'Connecting...'
  let connected = false
  let paired = false
  let bridgeReady = false
  let sessionId = ''
  let latencyMs: number | null = null
  let dragHeld = false

  let nonce = 0
  let pingSentAt = 0
  let pingTimer: number | undefined

  let activeTouchId: number | null = null
  let lastX = 0
  let lastY = 0
  let touchStartedAt = 0
  let movedDuringGesture = false
  let twoFingerMode = false
  let twoFingerY = 0

  let pendingDx = 0
  let pendingDy = 0
  let rafMove = 0

  function canControl(): boolean {
    return Boolean(socket && socket.connected && paired && sessionId)
  }

  function createAuth(): AuthEnvelope | null {
    if (!sessionId) {
      return null
    }

    nonce += 1
    return {
      sessionId,
      nonce,
      ts: Date.now(),
    }
  }

  function findTouchById(touches: TouchList, id: number): Touch | null {
    for (let i = 0; i < touches.length; i += 1) {
      const touch = touches.item(i)
      if (touch && touch.identifier === id) {
        return touch
      }
    }
    return null
  }

  function flushMoveQueue(): void {
    rafMove = 0
    if (!canControl()) {
      pendingDx = 0
      pendingDy = 0
      return
    }

    if (pendingDx === 0 && pendingDy === 0) {
      return
    }

    const auth = createAuth()
    if (!auth) {
      pendingDx = 0
      pendingDy = 0
      return
    }

    socket?.emit('pointer_move', {
      ...auth,
      dx: pendingDx,
      dy: pendingDy,
    })
    pendingDx = 0
    pendingDy = 0
  }

  function queueMove(dx: number, dy: number): void {
    pendingDx += dx
    pendingDy += dy

    if (rafMove === 0) {
      rafMove = requestAnimationFrame(flushMoveQueue)
    }
  }

  function click(button: 'left' | 'right' | 'middle'): void {
    if (!canControl()) {
      return
    }
    const auth = createAuth()
    if (!auth) {
      return
    }
    socket?.emit('pointer_click', { ...auth, button })
  }

  function setButton(isDown: boolean): void {
    if (!canControl()) {
      return
    }
    const auth = createAuth()
    if (!auth) {
      return
    }
    socket?.emit('pointer_button', { ...auth, button: 'left', isDown })
    dragHeld = isDown
  }

  function scrollBy(dy: number): void {
    if (!canControl()) {
      return
    }
    const auth = createAuth()
    if (!auth) {
      return
    }
    socket?.emit('pointer_scroll', { ...auth, dy })
  }

  function startHeartbeat(): void {
    if (pingTimer) {
      window.clearInterval(pingTimer)
    }

    pingTimer = window.setInterval(() => {
      if (!canControl()) {
        return
      }

      const auth = createAuth()
      if (!auth) {
        return
      }

      pingSentAt = performance.now()
      socket?.emit('ping_client', auth)
    }, 3500)
  }

  function applyPairResult(result: PairResult): void {
    paired = result.ok
    status = result.message
    if (result.ok && result.sessionId) {
      sessionId = result.sessionId
      nonce = 0
      startHeartbeat()
    }
  }

  async function loadBridgeInfo(): Promise<void> {
    const response = await fetch('/api/bridge-info')
    const data = await response.json()
    requiresCode = Boolean(data.requiresCode)
    bridgeReady = Number(data.protocolVersion) === PROTOCOL_VERSION
  }

  function connectSocket(): void {
    socket = io({
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    })

    socket.on('connect', () => {
      connected = true
      status = 'Connected. Pair to start controlling.'
    })

    socket.on('disconnect', () => {
      connected = false
      paired = false
      status = 'Disconnected from bridge.'
    })

    socket.on('bridge_hello', (payload: BridgeHello) => {
      requiresCode = payload.requiresCode
    })

    socket.on('pair_result', (result: PairResult) => {
      applyPairResult(result)
    })

    socket.on('bridge_error', (error: { code: string; message: string }) => {
      status = `${error.code}: ${error.message}`
    })

    socket.on('pong_server', () => {
      latencyMs = Math.max(1, Math.round(performance.now() - pingSentAt))
    })
  }

  function pairNow(): void {
    if (!socket || !socket.connected) {
      status = 'Bridge is not connected yet.'
      return
    }

    if (!token) {
      status = 'Missing token. Open the app using the bridge QR code.'
      return
    }

    status = 'Pairing...'
    socket.emit(
      'pair_request',
      {
        token,
        code: pairCode || undefined,
        deviceName: navigator.userAgent,
      },
      (result: PairResult) => applyPairResult(result),
    )
  }

  function handleTouchStart(event: TouchEvent): void {
    if (!canControl()) {
      return
    }

    if (event.touches.length === 2) {
      const first = event.touches.item(0)
      const second = event.touches.item(1)
      if (!first || !second) {
        return
      }

      twoFingerMode = true
      activeTouchId = null
      movedDuringGesture = false
      touchStartedAt = Date.now()
      twoFingerY = (first.clientY + second.clientY) / 2
      return
    }

    if (event.touches.length !== 1) {
      return
    }

    const touch = event.touches.item(0)
    if (!touch) {
      return
    }

    twoFingerMode = false
    activeTouchId = touch.identifier
    lastX = touch.clientX
    lastY = touch.clientY
    touchStartedAt = Date.now()
    movedDuringGesture = false
  }

  function handleTouchMove(event: TouchEvent): void {
    if (!canControl()) {
      return
    }

    if (twoFingerMode && event.touches.length === 2) {
      const first = event.touches.item(0)
      const second = event.touches.item(1)
      if (!first || !second) {
        return
      }

      const nextY = (first.clientY + second.clientY) / 2
      const delta = (nextY - twoFingerY) / 14
      if (Math.abs(delta) >= 1) {
        movedDuringGesture = true
        scrollBy(-delta)
        twoFingerY = nextY
      }
      return
    }

    if (activeTouchId === null) {
      return
    }

    const touch = findTouchById(event.touches, activeTouchId)
    if (!touch) {
      return
    }

    const dx = touch.clientX - lastX
    const dy = touch.clientY - lastY
    lastX = touch.clientX
    lastY = touch.clientY

    if (Math.abs(dx) + Math.abs(dy) > 1) {
      movedDuringGesture = true
      queueMove(dx, dy)
    }
  }

  function handleTouchEnd(event: TouchEvent): void {
    if (!canControl()) {
      return
    }

    const elapsed = Date.now() - touchStartedAt

    if (twoFingerMode) {
      if (event.touches.length === 0) {
        if (!movedDuringGesture && elapsed < 260) {
          click('right')
        }
        twoFingerMode = false
      }
      return
    }

    if (activeTouchId !== null && event.touches.length === 0) {
      if (!movedDuringGesture && elapsed < 240) {
        click('left')
      }
      activeTouchId = null
    }
  }

  onMount(async () => {
    const params = new URLSearchParams(window.location.search)
    token = params.get('token') ?? ''

    await loadBridgeInfo()
    connectSocket()
  })

  onDestroy(() => {
    if (rafMove) {
      cancelAnimationFrame(rafMove)
    }

    if (pingTimer) {
      window.clearInterval(pingTimer)
    }

    if (dragHeld && canControl()) {
      setButton(false)
    }

    socket?.disconnect()
  })
</script>

<main>
  <header>
    <div>
      <h1>Remote Touch Mouse</h1>
      <p>Scan bridge QR, pair, then use the pad as a trackpad.</p>
    </div>
    <div class={`chip ${connected ? 'ok' : ''}`}>{connected ? 'Bridge Online' : 'Bridge Offline'}</div>
  </header>

  <section class="pairing">
    <label>
      Pair token
      <input bind:value={token} placeholder="Token from QR URL" autocomplete="off" />
    </label>

    {#if requiresCode}
      <label>
        Pair code
        <input bind:value={pairCode} inputmode="numeric" maxlength="6" placeholder="4-digit code" />
      </label>
    {/if}

    <button type="button" on:click={pairNow} disabled={!bridgeReady}>Pair Device</button>
  </section>

  <section
    class={`trackpad ${paired ? 'armed' : ''}`}
    role="application"
    aria-label="Touch trackpad"
    on:touchstart|preventDefault={handleTouchStart}
    on:touchmove|preventDefault={handleTouchMove}
    on:touchend|preventDefault={handleTouchEnd}
    on:touchcancel|preventDefault={handleTouchEnd}
  >
    <div class="overlay">
      {#if paired}
        <strong>Trackpad active</strong>
        <span>Tap: left click | Two-finger tap: right click | Two-finger move: scroll</span>
      {:else}
        <strong>Pair first</strong>
        <span>Open this page from the bridge QR URL, then pair.</span>
      {/if}
    </div>
  </section>

  <section class="actions">
    <button type="button" on:click={() => click('left')} disabled={!paired}>Left Click</button>
    <button type="button" on:click={() => click('right')} disabled={!paired}>Right Click</button>
    <button type="button" class={dragHeld ? 'danger' : ''} on:click={() => setButton(!dragHeld)} disabled={!paired}>
      {dragHeld ? 'Release Drag' : 'Hold Drag'}
    </button>
  </section>

  <footer>
    <span>{status}</span>
    <span>{latencyMs === null ? 'Ping --' : `Ping ${latencyMs}ms`}</span>
  </footer>
</main>
