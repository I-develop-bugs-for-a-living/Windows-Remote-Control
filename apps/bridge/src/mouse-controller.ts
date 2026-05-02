import fs from 'node:fs'
import path from 'node:path'
import type { MouseButton } from '@remote-control/shared'

type NutJsModule = typeof import('@nut-tree-fork/nut-js')

let libnutOverrideInstalled = false

function resolvePackagedLibnutPath(): string | null {
  const exeDir = path.dirname(process.execPath)
  const candidates = [
    path.join(exeDir, 'native', 'libnut.node'),
    path.join(exeDir, 'libnut.node'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function toLibnutWithScreenHelpers(addonPath: string): unknown {
  const libnut = require(addonPath) as {
    captureScreen?: (...args: number[]) => {
      width: number
      height: number
      byteWidth: number
      bitsPerPixel: number
      bytesPerPixel: number
      image: unknown
    }
    highlight?: (
      x: number,
      y: number,
      width: number,
      height: number,
      duration: number,
      opacity: number,
    ) => void
    screen?: {
      highlight?: (
        x: number,
        y: number,
        width: number,
        height: number,
        duration: number,
        opacity: number,
      ) => void
      capture?: (x?: number, y?: number, width?: number, height?: number) => unknown
    }
  }

  if (!libnut.screen) {
    libnut.screen = {}
  }

  libnut.screen.highlight = (
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    opacity: number,
  ) => {
    let highlightOpacity = opacity < 0 ? 0 : opacity
    highlightOpacity = highlightOpacity > 1 ? 1 : highlightOpacity
    const highlightDuration = duration < 0 ? 0 : duration
    libnut.highlight?.(x, y, width, height, highlightDuration, highlightOpacity)
  }

  libnut.screen.capture = (x?: number, y?: number, width?: number, height?: number) => {
    const b =
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof width === 'number' &&
      typeof height === 'number'
        ? libnut.captureScreen?.(x, y, width, height)
        : libnut.captureScreen?.()

    if (!b) {
      throw new Error('Failed to capture screen from libnut addon.')
    }

    return {
      width: b.width,
      height: b.height,
      byteWidth: b.byteWidth,
      bitsPerPixel: b.bitsPerPixel,
      bytesPerPixel: b.bytesPerPixel,
      image: b.image,
    }
  }

  return libnut
}

function installPackagedLibnutOverride(addonPath: string): void {
  if (libnutOverrideInstalled) {
    return
  }

  const moduleApi = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }

  const originalLoad = moduleApi._load
  moduleApi._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === '@nut-tree-fork/libnut-win32') {
      return toLibnutWithScreenHelpers(addonPath)
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  libnutOverrideInstalled = true
}

function loadNutJs(): NutJsModule {
  const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
  if (process.platform === 'win32' && isPackaged) {
    const packagedLibnutPath = resolvePackagedLibnutPath()
    if (!packagedLibnutPath) {
      const expectedPath = path.join(path.dirname(process.execPath), 'native', 'libnut.node')
      throw new Error(
        `Missing native addon for packaged bridge. Expected file at: ${expectedPath}. ` +
          'Rebuild with "npm run package:exe" to include native dependencies.',
      )
    }
    installPackagedLibnutOverride(packagedLibnutPath)
  }

  return require('@nut-tree-fork/nut-js') as NutJsModule
}

export class MouseController {
  private readonly Button: NutJsModule['Button']
  private readonly Point: NutJsModule['Point']
  private readonly mouse: NutJsModule['mouse']

  constructor() {
    const nutJs = loadNutJs()
    this.Button = nutJs.Button
    this.Point = nutJs.Point
    this.mouse = nutJs.mouse
  }

  private toNutButton(button: MouseButton): NutJsModule['Button'][keyof NutJsModule['Button']] {
    if (button === 'right') {
      return this.Button.RIGHT
    }
    if (button === 'middle') {
      return this.Button.MIDDLE
    }
    return this.Button.LEFT
  }

  async moveBy(dx: number, dy: number, sensitivity: number): Promise<void> {
    const current = await this.mouse.getPosition()
    const nextX = Math.round(current.x + dx * sensitivity)
    const nextY = Math.round(current.y + dy * sensitivity)
    await this.mouse.setPosition(new this.Point(nextX, nextY))
  }

  async click(button: MouseButton): Promise<void> {
    await this.mouse.click(this.toNutButton(button))
  }

  async setButton(button: MouseButton, isDown: boolean): Promise<void> {
    const target = this.toNutButton(button)
    if (isDown) {
      await this.mouse.pressButton(target)
      return
    }
    await this.mouse.releaseButton(target)
  }

  async scroll(dy: number): Promise<void> {
    const amount = Math.max(-100, Math.min(100, Math.round(dy * 40)))
    if (amount > 0) {
      await this.mouse.scrollDown(amount)
      return
    }
    if (amount < 0) {
      await this.mouse.scrollUp(Math.abs(amount))
    }
  }
}
