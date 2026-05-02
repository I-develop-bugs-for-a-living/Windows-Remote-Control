import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const bridgeRoot = path.resolve(__dirname, '..')
const source = path.resolve(bridgeRoot, '../pwa/dist')
const target = path.resolve(bridgeRoot, 'pwa-dist')

await fs.rm(target, { recursive: true, force: true })
await fs.mkdir(target, { recursive: true })
await fs.cp(source, target, { recursive: true })

console.log(`Prepared PWA assets: ${source} -> ${target}`)
