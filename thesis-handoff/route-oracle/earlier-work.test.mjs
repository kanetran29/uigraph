/**
 * Checks earlier-work.mjs: an application is admitted by Oshima and Kishi's stated input restrictions only when no
 * declared route carries a parameter and none has children or loadChildren.
 * Run: node --test earlier-work.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Writes one route-parser output file per application into a fresh directory. */
function fixture(apps) {
  const dir = mkdtempSync(join(tmpdir(), 'earlier-work-'))
  for (const [slug, routes] of Object.entries(apps)) writeFileSync(join(dir, `${slug}.fin.C.json`), JSON.stringify({ routes }))
  return dir
}

test('counts the applications the stated restrictions admit, and why the others are not', () => {
  const dir = fixture({
    flat: [{ path: '/a', kind: 'SCREEN' }, { path: '/b', kind: 'SCREEN' }],
    params: [{ path: '/item/:id', kind: 'SCREEN' }],
    nested: [{ path: '/admin', kind: 'PREFIX' }, { path: '/admin/users', kind: 'SCREEN' }],
  })
  const tex = join(dir, 'out.tex')
  execFileSync('node', [join(import.meta.dirname, 'earlier-work.mjs'), '--dir', dir, '--apps', 'flat,params,nested', '--tex', tex])
  const out = readFileSync(tex, 'utf8')
  const macro = (n) => new RegExp(`\\\\newcommand\\{\\\\${n}\\}\\{([^}]*)\\}`).exec(out)?.[1]
  assert.equal(macro('EarlierWorkApps'), '3')
  assert.equal(macro('EarlierWorkParamApps'), '1')
  assert.equal(macro('EarlierWorkNestedApps'), '1')
  assert.equal(macro('EarlierWorkAdmittedApps'), '1')
})
