import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const preloadUrl = new URL('../out/preload/index.js', import.meta.url)
const mainUrl = new URL('../out/main/index.js', import.meta.url)
const [preload, main] = await Promise.all([
  readFile(preloadUrl, 'utf8'),
  readFile(mainUrl, 'utf8')
])

if (/^\s*import\s/m.test(preload) || !preload.includes('require("electron")')) {
  throw new Error(
    `Sandboxed preload must be CommonJS: ${fileURLToPath(preloadUrl)}`
  )
}

if (!main.includes('../preload/index.js')) {
  throw new Error(
    `Main process must load the CommonJS preload: ${fileURLToPath(mainUrl)}`
  )
}

console.log('Verified sandbox-compatible preload build.')
