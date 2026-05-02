export const PROTOCOL_VERSION = 1

export type MouseButton = 'left' | 'right' | 'middle'

export interface PairRequest {
  token: string
  code?: string
  deviceName?: string
}

export interface PairResult {
  ok: boolean
  message: string
  sessionId?: string
  sensitivity?: number
}

export interface AuthEnvelope {
  sessionId: string
  nonce: number
  ts: number
}

export interface PointerMove extends AuthEnvelope {
  dx: number
  dy: number
}

export interface PointerClick extends AuthEnvelope {
  button: MouseButton
}

export interface PointerButton extends AuthEnvelope {
  button: MouseButton
  isDown: boolean
}

export interface PointerScroll extends AuthEnvelope {
  dy: number
}

export interface PongPayload {
  serverTs: number
}

export interface BridgeHello {
  protocolVersion: number
  requiresCode: boolean
}

export interface ClientToServerEvents {
  pair_request: (
    payload: PairRequest,
    cb?: (result: PairResult) => void,
  ) => void
  pointer_move: (payload: PointerMove) => void
  pointer_click: (payload: PointerClick) => void
  pointer_button: (payload: PointerButton) => void
  pointer_scroll: (payload: PointerScroll) => void
  ping_client: (payload: AuthEnvelope) => void
}

export interface ServerToClientEvents {
  bridge_hello: (payload: BridgeHello) => void
  pair_result: (payload: PairResult) => void
  bridge_error: (payload: { code: string; message: string }) => void
  pong_server: (payload: PongPayload) => void
}
