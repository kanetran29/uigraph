#!/usr/bin/env node
// Checks guardedRoute against every REMOVE_GUARD site the corpus is known to exercise: the
// four the 1.4.0 exclusion rule failed to exclude, the two it did exclude, the five that are
// scored and name their component by module rather than by class, and one whose enclosing
// object a line comment closes early. Run with
//   node guard-resolve.test.mjs --corpus <dir>
// and it exits non-zero on the first case that does not resolve as recorded here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { guardedRoute, maskCode } from './guard-resolve.mjs'

const argv = process.argv.slice(2)
const i = argv.indexOf('--corpus')
const corpus = i > -1 ? argv[i + 1] : null
if (!corpus) {
  console.error('usage: node guard-resolve.test.mjs --corpus <dir>')
  process.exit(2)
}

const RW = 'realworld/src/app/app.routes.ts'
const BW = 'bitwarden/apps/web/src/app'
// file, 1-based line of the canActivate, the route's own path, whether it declares anything
// that can yield a screen, a component class its subtree must name, a module it must import.
const CASES = [
  // Excluded under 1.5.0: the guarded screens exist and no edge enters them.
  ['alfresco/projects/aca-content/src/lib/aca-content.routes.ts', 348, 'shared', true, 'SharedFilesComponent', null],
  [`${BW}/oss-routing.module.ts`, 524, null, true, 'AcceptEmergencyComponent', null],
  [`${BW}/vault/individual-vault/vault-routing.module.ts`, 45, null, true, 'VaultNextComponent', null],
  [`${BW}/oss-routing.module.ts`, 695, 'sends', true, 'SendComponent', null],
  ['bitwarden/apps/web/src/app/admin-console/organizations/reporting/organization-reporting-routing.module.ts', 85, 'weak-passwords-report', true, 'WeakPasswordsReportComponent', null],
  // Excluded because the route yields no screen at all: an empty children list, no component.
  [`${BW}/admin-console/organizations/organization-routing.module.ts`, 32, '', false, null, null],
  // Scored, and naming the component by the module a loadComponent imports rather than by
  // class. These are the sites that fell to the fallback check before modules were read.
  [RW, 26, 'login', true, null, './core/auth/auth.component'],
  [RW, 31, 'register', true, null, './core/auth/auth.component'],
  [RW, 36, 'settings', true, null, './features/settings/settings.component'],
  [RW, 48, '', true, null, './features/article/pages/editor/editor.component'],
  [RW, 53, ':slug', true, null, './features/article/pages/editor/editor.component'],
  // Scored, and its enclosing object ends `children: [], // ... work, },`: the comment closes
  // the object early unless it is masked, which would hide most of the subtree.
  [`${BW}/admin-console/organizations/organization-routing.module.ts`, 27, ':organizationId', true, 'GroupsComponent', null],
]

let failed = 0
for (const [rel, line, own, declares, component, module] of CASES) {
  const file = path.join(corpus, rel)
  if (!fs.existsSync(file)) { console.error(`SKIP ${rel}: not in the corpus at ${corpus}`); failed += 1; continue }
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const offset = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
  const idx = src.indexOf('canActivate:', offset)
  assert.notEqual(idx, -1, `${rel}:${line}: no canActivate at or after that line`)
  const r = guardedRoute(src, idx)
  try {
    assert.notEqual(r, null, `${rel}:${line}: the enclosing object did not resolve`)
    assert.equal(r.own, own, `${rel}:${line}: own path, got ${JSON.stringify(r.own)}`)
    assert.equal(r.declaresTarget, declares, `${rel}:${line}: declaresTarget`)
    if (component) assert.ok(r.components.includes(component), `${rel}:${line}: components ${JSON.stringify(r.components)} omit ${component}`)
    if (module) assert.ok(r.modules.includes(module), `${rel}:${line}: modules ${JSON.stringify(r.modules)} omit ${module}`)
    if (!component && !module) {
      assert.deepEqual(r.components, [], `${rel}:${line}: expected no component, got ${JSON.stringify(r.components)}`)
      assert.deepEqual(r.modules, [], `${rel}:${line}: expected no module, got ${JSON.stringify(r.modules)}`)
    }
    console.log(`ok   ${rel.split('/').pop()}:${line}  own=${JSON.stringify(r.own)} declares=${r.declaresTarget} ` +
      `components=${JSON.stringify(r.components).slice(0, 44)} modules=${JSON.stringify(r.modules).slice(0, 44)}`)
  } catch (e) {
    failed += 1
    console.error(`FAIL ${e.message}`)
  }
}

// Masking preserves offsets, or every span the caller computes would be wrong.
const sample = fs.readFileSync(path.join(corpus, RW), 'utf8')
try {
  assert.equal(maskCode(sample).length, sample.length, 'maskCode changed the length of the source')
  console.log('ok   maskCode preserves offsets')
} catch (e) { failed += 1; console.error(`FAIL ${e.message}`) }

console.log(failed ? `\n${failed} of ${CASES.length + 1} checks failed` : `\nall ${CASES.length + 1} checks pass`)
process.exit(failed ? 1 : 0)
