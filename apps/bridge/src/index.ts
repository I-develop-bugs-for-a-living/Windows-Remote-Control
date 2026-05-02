import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'
import { Server } from 'socket.io'

import {
  PROTOCOL_VERSION,
  type AuthEnvelope,
  type ClientToServerEvents,
  type PairResult,
  type PairRequest,
  type PointerButton,
  type PointerClick,
  type PointerMove,
  type PointerScroll,
  type ServerToClientEvents,
} from '@remote-control/shared'

import { MouseController } from './mouse-controller'
import { findLanIp, isPrivateIp, normalizeIp } from './network'

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10)
const REQUIRE_PAIR_CODE = process.env.REQUIRE_PAIR_CODE !== 'false'
const NONCE_WINDOW_MS = 15000
const RATE_LIMIT_PER_SEC = 100
const CURSOR_SENSITIVITY = Number.parseFloat(process.env.CURSOR_SENSITIVITY ?? '2')

const pairToken = crypto.randomBytes(16).toString('hex')
const pairCode = (Math.floor(Math.random() * 9000) + 1000).toString()

interface SessionState {
  paired: boolean
  sessionId?: string
  lastNonce: number
  bucketCount: number
  bucketStart: number
}

const sessionStates = new Map<string, SessionState>()

const mouseController = new MouseController()
const app = express()
const server = app.listen(PORT)
const io = new Server<ClientToServerEvents, ServerToClientEvents, object, { sessionId?: string }>(
  server,
  {
  transports: ['websocket', 'polling'],
  },
)

const localIp = findLanIp(process.env.BRIDGE_HOST)
const baseUrl = `http://${localIp}:${PORT}`
const pairUrl = `${baseUrl}/?token=${pairToken}`

function resolvePwaDir(): string | null {
  const envDir = process.env.PWA_DIR
  if (envDir && fs.existsSync(envDir)) {
    return envDir
  }

  const bundled = path.resolve(__dirname, '../pwa-dist')
  if (fs.existsSync(bundled)) {
    return bundled
  }

  const packaged = path.join(path.dirname(process.execPath), 'pwa-dist')
  if (fs.existsSync(packaged)) {
    return packaged
  }

  const devDist = path.resolve(__dirname, '../../pwa/dist')
  if (fs.existsSync(devDist)) {
    return devDist
  }

  return null
}

const pwaDir = resolvePwaDir()

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/bridge-info', (_req, res) => {
  res.json({
    protocolVersion: PROTOCOL_VERSION,
    requiresCode: REQUIRE_PAIR_CODE,
    pairCodeHint: REQUIRE_PAIR_CODE ? 'Use the code shown in the PC bridge console.' : null,
  })
})

app.get('/api/qr.svg', async (_req, res) => {
  const svg = await QRCode.toString(pairUrl, { type: 'svg', margin: 1, width: 280 })
  res.type('image/svg+xml').send(svg)
})

if (pwaDir) {
  app.use(express.static(pwaDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(pwaDir, 'index.html'))
  })
} else {
  app.get('*', (_req, res) => {
    res
      .status(503)
      .send('PWA build was not found. Run "npm run build -w apps/pwa" and restart the bridge.')
  })
}

function createSessionId(): string {
  return crypto.randomUUID()
}

function consumeRateLimit(state: SessionState): boolean {
  const now = Date.now()
  if (now - state.bucketStart >= 1000) {
    state.bucketStart = now
    state.bucketCount = 0
  }

  if (state.bucketCount >= RATE_LIMIT_PER_SEC) {
    return false
  }

  state.bucketCount += 1
  return true
}

function verifyAuth(socketId: string, auth: AuthEnvelope): boolean {
  const state = sessionStates.get(socketId)
  if (!state || !state.paired || !state.sessionId) {
    return false
  }

  if (!consumeRateLimit(state)) {
    return false
  }

  if (auth.sessionId !== state.sessionId) {
    return false
  }

  const now = Date.now()
  if (Math.abs(now - auth.ts) > NONCE_WINDOW_MS) {
    return false
  }

  if (auth.nonce <= state.lastNonce) {
    return false
  }

  state.lastNonce = auth.nonce
  return true
}

io.on('connection', (socket) => {
  sessionStates.set(socket.id, {
    paired: false,
    lastNonce: 0,
    bucketCount: 0,
    bucketStart: Date.now(),
  })

  const remoteIp = normalizeIp(socket.handshake.address)

  if (!isPrivateIp(remoteIp)) {
    socket.emit('bridge_error', {
      code: 'LAN_ONLY',
      message: 'Only private LAN clients are allowed.',
    })
    socket.disconnect(true)
    return
  }

  socket.emit('bridge_hello', {
    protocolVersion: PROTOCOL_VERSION,
    requiresCode: REQUIRE_PAIR_CODE,
  })

  socket.on('pair_request', (payload: PairRequest, cb?: (result: PairResult) => void) => {
    const tokenOk = payload.token === pairToken
    const codeOk = !REQUIRE_PAIR_CODE || payload.code === pairCode

    if (!tokenOk || !codeOk) {
      const result = {
        ok: false,
        message: 'Pairing failed. Verify token and code.',
      }
      socket.emit('pair_result', result)
      cb?.(result)
      return
    }

    const state = sessionStates.get(socket.id)
    if (!state) {
      return
    }

    const sessionId = createSessionId()
    socket.data.sessionId = sessionId
    state.paired = true
    state.sessionId = sessionId
    state.lastNonce = 0
    state.bucketCount = 0
    state.bucketStart = Date.now()

    const result = {
      ok: true,
      message: 'Pairing complete.',
      sessionId,
      sensitivity: CURSOR_SENSITIVITY,
    }

    socket.emit('pair_result', result)
    cb?.(result)
  })

  socket.on('pointer_move', async (payload: PointerMove) => {
    if (!verifyAuth(socket.id, payload)) {
      return
    }
    await mouseController.moveBy(payload.dx, payload.dy, CURSOR_SENSITIVITY)
  })

  socket.on('pointer_click', async (payload: PointerClick) => {
    if (!verifyAuth(socket.id, payload)) {
      return
    }
    await mouseController.click(payload.button)
  })

  socket.on('pointer_button', async (payload: PointerButton) => {
    if (!verifyAuth(socket.id, payload)) {
      return
    }
    await mouseController.setButton(payload.button, payload.isDown)
  })

  socket.on('pointer_scroll', async (payload: PointerScroll) => {
    if (!verifyAuth(socket.id, payload)) {
      return
    }
    await mouseController.scroll(payload.dy)
  })

  socket.on('ping_client', (payload: AuthEnvelope) => {
    if (!verifyAuth(socket.id, payload)) {
      return
    }
    socket.emit('pong_server', { serverTs: Date.now() })
  })

  socket.on('disconnect', () => {
    sessionStates.delete(socket.id)
  })
})

console.log('Remote Control Bridge started')
console.log(`URL: ${baseUrl}`)
console.log(`Pair URL: ${pairUrl}`)
if (REQUIRE_PAIR_CODE) {
  console.log(`Pair code: ${pairCode}`)
}
console.log('Scan this QR code from your phone:')
qrcodeTerminal.generate(pairUrl, { small: true })
