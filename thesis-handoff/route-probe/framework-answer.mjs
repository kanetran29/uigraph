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
 * Does a framework route pattern match an address? A `:param` segment takes any one segment. The
 * hole is read on the ROUTE side only, because an address this is asked about is as often as not a
 * pattern itself and reading its holes as wildcards credited a withdrawal to a route at a
 * different address: `/clients/:clientId/savings-accounts/:savingAccountId/transfer-funds` was
 * answered by a screen whose corresponding segment is a literal. `patternAddress` says when an
 * address carries a hole, and the caller answers over the family rather than over one arbitrary
 * member of it.
 */
export function matches(pattern, address) {
  const ps = norm(pattern).split('/').filter(Boolean)
  const as = norm(address).split('/').filter(Boolean)
  if (ps.length !== as.length) return false
  return ps.every((seg, i) => seg.startsWith(':') || seg === '*' || seg === as[i])
}

/** Does this address carry a hole, so that it names a family of addresses and not one? */
export function patternAddress(address) {
  return norm(address).split('/').filter(Boolean).some((seg) => seg.startsWith(':') || seg === '*')
}

/**
 * The framework's answer: `screen` when a route places a component of its own there, `redirect`
 * when it sends the visitor elsewhere, `no-screen` when a route matches the address but places
 * only chrome, `catch-all` when nothing but a wildcard matches, and `undecided` when nothing here
 * can say. A route carrying children is never a screen at its own address: the component it names
 * is the chrome every address under it also places.
 *
 * Three things this has to get right and the first version did not. The answer does not depend on
 * the order of the route array: every matching route is read and the kinds are ranked, rather than
 * the first match winning. A `UrlMatcher` leaves undecided only the addresses it could claim ---
 * the ones under its own prefix --- where before any matcher anywhere made every address in the
 * application undecided, which withheld twelve findings on a ground a navigation refutes
 * (ghostfolio's matcher sits at `/admin` and cannot claim `/`). And an address that carries a hole
 * names a family: when the family holds both a screen and something else, no single answer is
 * true of it, so it is undecided rather than withdrawn.
 */
export function frameworkAnswer(routes, address) {
  const addr = norm(address)
  const family = patternAddress(addr)
  const kinds = new Set()
  let vetoed = false
  for (const r of routes) {
    if (r.outlet && r.outlet !== 'primary') continue
    const own = norm(r.fullPath)
    if (r.hasMatcher || r.underMatcher) {
      if (addr === own || addr.startsWith(own === '/' ? '/' : own + '/')) vetoed = true
      continue
    }
    if (/\*\*?$/.test(own)) continue
    if (!matches(r.fullPath, addr)) continue
    if (r.redirectTo) kinds.add('redirect')
    else if ((r.component || r.hasLoadComponent) && !r.hasChildren && !r.hasLoadChildren) kinds.add('screen')
    else kinds.add('no-screen')
  }
  if (vetoed) return 'undecided'
  if (kinds.size === 0) return 'catch-all'
  if (family && kinds.has('screen') && kinds.size > 1) return 'undecided'
  if (kinds.has('screen')) return 'screen'
  if (kinds.has('redirect')) return 'redirect'
  return 'no-screen'
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
  let cmpChecked = 0
  let cmpFailed = 0
  const absent = []
  for (const slug of ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']) {
    let answer
    // A measurement that is absent is not a measurement that agreed. Skipping it in silence let a
    // run in which five of six applications never booted print a full pass at exit 0.
    try { answer = JSON.parse(readFileSync(`${dir}/${slug}.answer.json`, 'utf8')) } catch { absent.push(slug); continue }
    const probe = JSON.parse(readFileSync(`${dir}/${slug}.probe.json`, 'utf8'))
    // The comparison does not call frameworkAnswer: it decides for itself which of the
    // configuration's entries answer an address, and publishes the result as the list of
    // addresses it found. Validating only the classifier above would leave the predicate behind
    // every figure in the comparison table unvalidated, so the same navigations are held against
    // that list, on the two implications that matter and no more. An address the framework was
    // seen to serve with a screen of its own must be in the list, or the comparison is missing a
    // screen it should have counted; an address answered only by the catch-all must not be, or it
    // is counting an address nothing serves. A redirect and a chrome-only address carry no
    // implication either way, because the configuration can place chrome at an address AND
    // forward it, which is what mifos does at `/` --- the comparison reports those in a column of
    // their own rather than among the screens. The list holds PATTERNS, so a navigated address is
    // matched against them rather than looked up.
    let served = null
    try { served = JSON.parse(readFileSync(`${dir}/${slug}.cmp.json`, 'utf8')).frameworkAddresses } catch {}
    if (Array.isArray(served)) {
      for (const row of answer.results) {
        if (frameworkAnswer(probe.routes, row.target) === 'undecided') continue
        const seen = observed(row)[0]
        if (seen !== 'screen' && seen !== 'catch-all') continue
        const held = served.some((pattern) => matches(pattern, row.target))
        cmpChecked += 1
        if (held !== (seen === 'screen')) {
          cmpFailed += 1
          console.error(`  ${slug} ${row.target}: the comparison ${held ? 'holds' : 'does not hold'} this address, the framework did ${seen}`)
        }
      }
    }
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
  if (cmpChecked > 0) console.log(`comparison self-check: ${cmpChecked - cmpFailed}/${cmpChecked} addresses the comparison holds agree with the navigation`)
  if (absent.length > 0) {
    console.error(`  no answerability measurement for ${absent.join(', ')}`)
    process.exit(1)
  }
  if (checked === 0) {
    console.error('  no answerability measurement found: run answerability.mjs first')
    process.exit(2)
  }
  process.exit(failed === 0 && cmpFailed === 0 ? 0 : 1)
}
