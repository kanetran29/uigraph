/**
 * Probes every corpus application and compares each result with the extractor's
 * graph and the static oracle's declared route set. Writes one probe file and
 * one comparison file per application into the results directory, and exits
 * non-zero when any application could not be probed, because an application
 * that failed to boot must never be read as one the framework mounts nothing in.
 *
 * Usage: node run-all.mjs --dist-root <dir> --corpus-root <dir> --oracle <dir> --out <dir>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** Reads the flags this script takes into a plain object. */
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = next && !next.startsWith('--') ? next : true
  }
  return out
}

/** Runs one node script and lets its output through, returning its exit status. */
function node(script, argv) {
  try {
    execFileSync(process.execPath, ['--no-warnings', join(HERE, script), ...argv], { stdio: 'inherit' })
    return 0
  } catch (e) {
    return e.status ?? 1
  }
}

const a = args(process.argv.slice(2))
for (const need of ['dist-root', 'corpus-root', 'oracle', 'out']) {
  if (a[need]) continue
  console.error(`usage: node run-all.mjs --dist-root <dir> --corpus-root <dir> --oracle <dir> --out <dir>`)
  process.exit(2)
}
mkdirSync(a.out, { recursive: true })

const manifest = JSON.parse(readFileSync(join(HERE, 'apps.json'), 'utf8'))
let failed = 0
for (const app of manifest.apps) {
  const probeOut = join(a.out, `${app.slug}.probe.json`)
  const probeArgs = ['--slug', app.slug, '--dist', join(a['dist-root'], app.dist), '--out', probeOut, '--wait', '12000']
  if (app.base) probeArgs.push('--base', app.base)
  if (node('probe.mjs', probeArgs) !== 0) {
    failed += 1
    continue
  }
  const status = node('compare-probe.mjs', [
    '--probe', probeOut,
    '--oracle', join(a.oracle, `${app.slug}.fin.C.json`),
    '--db', join(a['corpus-root'], app.appDir, 'uigraph.db'),
    '--out', join(a.out, `${app.slug}.cmp.json`),
  ])
  if (status !== 0) failed += 1
}
if (failed > 0) {
  console.error(`${failed} application(s) could not be probed or compared`)
  process.exit(1)
}
