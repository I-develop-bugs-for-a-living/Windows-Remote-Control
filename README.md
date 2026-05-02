# Remote Touch Mouse

LAN-only virtual mouse system using:

- Svelte 5 PWA (touch trackpad UI)
- Node.js bridge with Socket.IO
- QR-based pairing bootstrap
- Windows single executable packaging

The bridge hosts the PWA itself on your PC to avoid HTTPS/mixed-content issues.

## Workspace Layout

- `apps/pwa`: Svelte 5 touch controller
- `apps/bridge`: Node bridge, QR + pairing + mouse control
- `packages/shared`: shared event contracts and protocol types

## What Works In This MVP

- Bridge starts on local network IP and prints:
  - URL
  - Pair URL with token
  - Pair code
  - terminal QR code
- Phone opens bridge URL directly over LAN
- Socket.IO connection on same origin
- Pairing via token + code
- Touch controls:
  - one-finger move: relative cursor movement
  - tap: left click
  - two-finger tap: right click
  - two-finger drag: scroll
- Manual action buttons:
  - left click
  - right click
  - hold/release drag
- Basic guards:
  - LAN private IP check
  - nonce/timestamp auth envelope
  - per-socket rate limit

## Prerequisites

- Windows PC
- Node.js 18+ for development
- Phone on the same Wi-Fi network

## Install

```powershell
npm install
```

## Development

Build all parts and run bridge locally:

```powershell
npm run dev
```

This builds shared + pwa, then starts bridge in watch mode.

## Production Build

```powershell
npm run build
```

## Create Windows Executable

```powershell
npm run package:exe
```

Executable output:

- `release/RemoteControlBridge.exe`
- `release/native/libnut.node`

## Run Packaged Bridge

```powershell
./release/RemoteControlBridge.exe
```

The bridge resolves native dependencies relative to the executable location, so it can be launched from any current working directory.

Then on your phone:

1. Scan QR from PC terminal.
2. Enter pair code shown in terminal.
3. Use touchpad area to control cursor.

## Configuration

Bridge supports environment variables:

- `PORT` (default `3000`)
- `BRIDGE_HOST` (optional; force a specific LAN IP, for example `192.168.2.167`)
- `REQUIRE_PAIR_CODE` (default `true`; set `false` to skip code)
- `CURSOR_SENSITIVITY` (default `1`)
- `PWA_DIR` (optional explicit static assets directory)

## Notes

- Designed for same-Wi-Fi private LAN only.
- `pkg` may show bytecode warnings due modern syntax; executable still runs.
- Native mouse dependency may trigger AV warnings in some environments; code-signing is recommended for distribution.
