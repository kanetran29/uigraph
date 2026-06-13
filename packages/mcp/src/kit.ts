// Resolver for the shipped agent kit (kit/ at the repo root): the markdown skill +
// rules + guides + loop playbook an LLM consumer loads to drive uigraph correctly.
// The kit is the single source of truth; this module reads it so the MCP server can
// expose it as resources and the CLI can print/install it. Pure file reads, no IO
// beyond the bundled kit directory.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One file in the kit, from the manifest. */
export interface KitFile {
  path: string
  title: string
  kind: 'skill' | 'rule' | 'guide' | 'loop'
}

/** The kit manifest: a machine-readable index + the tool names the kit documents. */
export interface KitManifest {
  version: number
  name: string
  files: KitFile[]
  tools: string[]
}

/** Locate the bundled `kit/` directory by walking up from this module until a manifest is found. */
export function kitDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'kit')
    if (existsSync(join(candidate, 'manifest.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('uigraph kit/ directory not found (expected a kit/manifest.json above the package)')
}

/** The parsed kit manifest. */
export function kitManifest(): KitManifest {
  return JSON.parse(readFileSync(join(kitDir(), 'manifest.json'), 'utf8')) as KitManifest
}

/** The kit's files in manifest order. */
export function listKit(): KitFile[] {
  return kitManifest().files
}

/** Read one kit file by its manifest-relative path (path-traversal guarded). */
export function readKitFile(relPath: string): string {
  const root = kitDir()
  const full = resolve(root, relPath)
  if (full !== root && !full.startsWith(root + '/')) throw new Error(`kit path escapes the kit directory: ${relPath}`)
  return readFileSync(full, 'utf8')
}

/** The whole kit concatenated in manifest order — one read bootstraps a consumer agent. */
export function readKitAll(): string {
  return listKit()
    .map((f) => `<!-- ${f.path} -->\n${readKitFile(f.path)}`)
    .join('\n\n---\n\n')
}
