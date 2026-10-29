/**
 * What the framework does with an address, decided from the route configuration the runtime probe
 * read out of the live Router. The dead-link census asks this of every candidate target: a link
 * whose target the framework mounts nothing at is a dead link whatever the extractor could or
 * could not read, which is a per-candidate check and so does not rest on an application's route
 * set being complete.
 *
 * Four answers, because the question has four, and the three that are not `catch-all` all mean
 * the visitor arrives somewhere. `--self-check` holds the classification against what the
 * framework was observed to do, from answerability.mjs, so the premise is measured and not
 * assumed: the one it would be easiest to get wrong is that a route carrying children places no
 * screen at its own address, and a navigation to mifos's /collections shows the recogniser
 * activating a last route with no component at all there.
 */
import { readFileSync } from 'node:fs'

/** An address with no trailing slash, so `/x/` and `/x` are one address. */
export const norm = (p) => (p || '').replace(/\/+$/, '') || '/'

/**
 * Does a framework route pattern match an address? A `:param` segment takes any one segment, and
 * it is read that way on BOTH sides, because an address this is asked about is as often as not a
 * pattern itself --- a link target the extractor read out of a template carries the hole the
 * template carries. Reading a hole as a wildcard makes the match easier, and an easier match only
 * ever moves a candidate OUT of the dead-link census, which is the direction a wrong answer here
 * must fall in.
 */
export function matches(pattern, address) {
  const hole = (seg) => seg.startsWith(':') || seg === '*'
  const ps = norm(pattern).split('/').filter(Boolean)
  const as = norm(address).split('/').filter(Boolean)
  if (ps.length !== as.length) return false
  return ps.every((seg, i) => hole(seg) || hole(as[i]) || seg === as[i])
}

/**
 * The framework's answer: `screen` when a route places a component of its own there, `redirect`
 * when it sends the visitor elsewhere, `no-screen` when a route matches the address but places
 * only chrome, `catch-all` when nothing but a wildcard matches, and `undecided` when the
 * application mounts a route through a `UrlMatcher` and nothing else matched. A route carrying
 * children is never a screen at its own address: the component it names is the chrome every
 * address under it also places.
 *
 * The `undecided` answer is not caution, it is the only sound reading. A matcher decides its
 * address in a function the configuration does not spell out, so it may claim ANY address, and a
 * navigation showed it doing so: ghostfolio mounts /admin/users behind one, and this
 * classification called that address unmounted until the matcher was accounted for.
 */
export function frameworkAnswer(routes, address) {
  let best = 'catch-all'
  for (const r of routes) {
    if (r.outlet && r.outlet !== 'primary') continue
    if (r.hasMatcher || r.underMatcher) { best = 'undecided'; continue }
    if (/\*\*?$/.test(norm(r.fullPath))) continue
    if (!matches(r.fullPath, address)) continue
    if (r.redirectTo) return 'redirect'
    if ((r.component || r.hasLoadComponent) && !r.hasChildren && !r.hasLoadChildren) return 'screen'
    best = 'no-screen'
  }
  return best
}

/**
 * The answer a navigation observed, read off answerability.mjs output. A navigation cannot tell a
 * redirect declared at the address from one a catch-all supplied, because Angular applies
 * redirects before it recognises anything and the event carries only the address it ended at, so
 * a redirect is reported as either and the check accepts both. What it CAN tell, and what the
 * classification above would be easiest to get wrong, is whether the address places a screen of
 * its own, and that is the comparison this check exists for.
 */
function observed(row) {
  if (!row.recognized) return ['catch-all']
  if (row.catchAll) return ['catch-all']
  if (row.redirected) return ['redirect', 'catch-all']
  return row.placesComponent ? ['screen'] : ['no-screen']
}

if (process.argv.includes('--self-check')) {
  const i = process.argv.indexOf('--self-check')
  const dir = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : 'results'
  let checked = 0
  let failed = 0
  let undecided = 0
  for (const slug of ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']) {
    let answer
    try { answer = JSON.parse(readFileSync(`${dir}/${slug}.answer.json`, 'utf8')) } catch { continue }
    const probe = JSON.parse(readFileSync(`${dir}/${slug}.probe.json`, 'utf8'))
    for (const row of answer.results) {
      const got = frameworkAnswer(probe.routes, row.target)
      const want = observed(row)
      if (got === 'undecided') { undecided += 1; continue }
      checked += 1
      if (!want.includes(got)) {
        failed += 1
        console.error(`  ${slug} ${row.target}: configuration says ${got}, the framework did ${want.join(' or ')}`)
      }
    }
  }
  console.log(`framework-answer self-check: ${checked - failed}/${checked} addresses agree with the navigation` + (undecided > 0 ? `, ${undecided} left undecided by a UrlMatcher` : ''))
  if (checked === 0) {
    console.error('  no answerability measurement found: run answerability.mjs first')
    process.exit(2)
  }
  process.exit(failed === 0 ? 0 : 1)
}
