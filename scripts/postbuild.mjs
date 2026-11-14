/**
 * Cross-platform post-build step for `output: "standalone"`.
 *
 * The previous npm script used Unix-only `cp -r`, so `npm run build` failed on
 * Windows after a successful `next build`. This Node script performs the exact
 * same copy with node:fs and works identically on Linux (deploy staging),
 * macOS and Windows.
 *
 * Deploy note: deploy.py uploads scripts/ and runs `npm run build` in the
 * staging dir on the server, so this file is always present when needed.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const nextDir = join(root, '.next')
const standalone = join(nextDir, 'standalone')

if (!existsSync(join(standalone, 'server.js'))) {
  console.error('[postbuild] .next/standalone/server.js not found — was this built with output:"standalone"?')
  process.exit(1)
}

// 1. Static chunks must live inside the standalone tree that the server serves.
mkdirSync(join(standalone, '.next'), { recursive: true })
cpSync(join(nextDir, 'static'), join(standalone, '.next', 'static'), { recursive: true })

// 2. public/ assets (icons, manifest, service worker, offline fallback).
cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true })

console.log('[postbuild] copied .next/static and public into .next/standalone')
