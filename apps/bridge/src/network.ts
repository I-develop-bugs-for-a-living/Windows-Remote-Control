import os from 'node:os'

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^127\./,
  /^::1$/,
]

const VIRTUAL_INTERFACE_NAME =
  /(tailscale|zerotier|wireguard|vpn|vethernet|hyper-v|virtual|vmware|docker|wsl)/i
const PREFERRED_INTERFACE_NAME = /(wi-?fi|wlan|wireless|ethernet|lan)/i

function isIpv4(value: string): boolean {
  const octets = value.split('.')
  if (octets.length !== 4) {
    return false
  }

  return octets.every((part) => {
    const num = Number.parseInt(part, 10)
    return Number.isInteger(num) && num >= 0 && num <= 255
  })
}

function scoreIp(address: string): number {
  if (address.startsWith('192.168.')) {
    return 300
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) {
    return 240
  }
  if (address.startsWith('10.')) {
    return 180
  }
  return 0
}

function scoreInterfaceName(name: string): number {
  if (VIRTUAL_INTERFACE_NAME.test(name)) {
    return -120
  }
  if (PREFERRED_INTERFACE_NAME.test(name)) {
    return 40
  }
  return 0
}

export function findLanIp(preferredHost?: string): string {
  if (preferredHost && isIpv4(preferredHost)) {
    return preferredHost
  }

  const interfaces = os.networkInterfaces()
  const candidates: Array<{ ip: string; score: number }> = []

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue
    }

    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue
      }

      const ipScore = scoreIp(entry.address)
      if (ipScore === 0) {
        continue
      }

      candidates.push({
        ip: entry.address,
        score: ipScore + scoreInterfaceName(name),
      })
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0].ip
  }

  return '127.0.0.1'
}

export function normalizeIp(value: string): string {
  if (value.startsWith('::ffff:')) {
    return value.slice(7)
  }
  return value
}

export function isPrivateIp(value: string): boolean {
  const normalized = normalizeIp(value)
  return PRIVATE_RANGES.some((pattern) => pattern.test(normalized))
}
