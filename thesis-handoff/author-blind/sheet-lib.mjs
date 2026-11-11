/**
 * Helpers shared by the builders of the blind reading sheets: stable ids, the application
 * directories of the head-to-head comparison (rima/head2head/apps.txt, which also lists Rima et
 * al.'s subjects at the checkouts the first comparison read) and numbered source excerpts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

export const WORK = join(homedir(), 'personal/uigraph-work')

/** Stable short hash, used for item ids and for an order that hides the item's kind. */
export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10)

/** Reads a JSON file given relative to this directory. */
export const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))

/** Maps each application slug of apps.txt to its absolute checkout directory. */
export function appDirs() {
  const dirs = {}
  for (const l of readFileSync(new URL('../rima/head2head/apps.txt', import.meta.url), 'utf8').split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue
    const [slug, dir] = l.split(/\s+/)
    dirs[slug] = join(WORK, dir)
  }
  return dirs
}

/** The numbered lines around line `n` of `file` under `dir`, the cited line flagged; null when the file or line is absent. */
export function snippet(dir, file, n, context) {
  const path = join(dir, file)
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split('\n')
  if (!(n >= 1 && n <= lines.length)) return null
  const from = Math.max(1, n - context)
  return lines.slice(from - 1, Math.min(lines.length, n + context)).map((text, i) => ({ n: from + i, text, cited: from + i === n }))
}

/** One labelled block per readable "file:line" site, in the order given. */
export function blocksOf(dir, sites, context) {
  return sites.flatMap((site) => {
    const m = /^(.+):(\d+)$/.exec(site)
    const lines = m && snippet(dir, m[1], Number(m[2]), context)
    return lines ? [{ label: site, lines }] : []
  })
}

/** Writes a sheet next to this file, items in id order so the order hides each item's kind. */
export function writeSheet(name, sheet) {
  sheet.items.sort((a, b) => a.id.localeCompare(b.id))
  writeFileSync(new URL(name, import.meta.url), JSON.stringify(sheet, null, 1) + '\n')
}

/** The reading rule of the source readings (rima/PREREGISTRATION.txt M4, head2head PREREGISTRATION.txt). */
export const PAIR_RULE =
  'A pair (s, t) is real if a user on screen s can trigger a navigation that lands on t: a link, or a handler that calls the router directly, through helpers or through an injected service, in a component shown on s (the routed components, the shell above the outlet, what their templates include, dialogs they open), possibly after an await or behind a guard, the trigger being shown while the user stays on s. Spurious if no such trigger exists. Unclear if the source does not decide it. A route parameter may take any value; a redirect counts. The sites shown under an item are starting points, constructs a tool relates to the pair or to its target (no tool is named); they are not evidence either way, so read the source around and beyond them.'

/** A path under the home directory written with ~, so committed sheets carry no account name. */
export const tilde = (p) => p.replace(homedir(), '~')
