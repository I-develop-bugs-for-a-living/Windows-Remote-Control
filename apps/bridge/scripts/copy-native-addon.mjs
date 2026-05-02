import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const bridgeRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(bridgeRoot, '../..')
const source = path.resolve(
  workspaceRoot,
  'node_modules/@nut-tree-fork/libnut-win32/build/Release/libnut.node',
)
const targetDir = path.resolve(workspaceRoot, 'release/native')
const target = path.resolve(targetDir, 'libnut.node')

try {
  await fs.access(source)
} catch {
  throw new Error(
    `Native addon not found at ${source}. Run npm install from workspace root before packaging.`,
  )
}

await fs.mkdir(targetDir, { recursive: true })
await fs.copyFile(source, target)

console.log(`Copied native addon: ${source} -> ${target}`)
