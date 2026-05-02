declare module 'qrcode-terminal' {
  export interface QRCodeTerminalOptions {
    small?: boolean
  }

  export function generate(text: string, options?: QRCodeTerminalOptions): void

  const api: {
    generate: typeof generate
  }

  export default api
}
