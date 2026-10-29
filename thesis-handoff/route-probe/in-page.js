/**
 * Runs inside a booted Angular application and reports the route set the
 * framework itself holds. It finds the live Router, then expands every lazily
 * loaded subtree by calling the application's own `loadChildren` closure and
 * reading the routes out of whatever that closure resolves to -- a plain array
 * for a standalone subtree, or the ROUTES multi-providers of an NgModule.
 * Nothing here re-implements Angular's reading of the route files, which is the
 * whole point: it is the application's own code that answers.
 *
 * Every place the walk stops short of a value it could have read is pushed into
 * `lazyFailures`, whether or not routes came back from the other half of the
 * same merge. Downstream the empty array is read as proof that no subtree was
 * left unexpanded, and a partial read shrinks the comparison set exactly as a
 * total failure does.
 *
 * Returns a JSON-safe object; Playwright carries it out of the page.
 */
globalThis.__uigraphProbe = async function probeAngularRoutes(options) {
  const opt = Object.assign({ maxDepth: 24, deadlineMs: 180000 }, options || {})
  const startedAt = Date.now()
  const diagnostics = []
  const router = findRouter(diagnostics)
  if (!router) return { ok: false, reason: 'router-not-found', diagnostics }

  const out = []
  const lazyFailures = []
  const chain = new Set()
  await expand(router.config, '', chain, out, 0)
  return {
    ok: true,
    routes: out,
    lazyFailures,
    diagnostics,
    elapsedMs: Date.now() - startedAt,
    routerFound: true,
  }

  /**
   * Searches every Angular component and directive instance on the page for an
   * object that behaves like a Router. Angular's own RouterLink and most app
   * shells hold one, and a development build keeps the field names readable.
   */
  function findRouter(log) {
    const ng = globalThis.ng
    if (!ng || typeof ng.getComponent !== 'function') {
      log.push('window.ng is absent: build the application in development mode')
      return null
    }
    const instances = []
    const elements = Array.from(document.querySelectorAll('*')).slice(0, 4000)
    for (const el of [document.body, ...elements]) {
      try {
        const c = ng.getComponent(el)
        if (c) instances.push(c)
      } catch {}
      try {
        const ds = ng.getDirectives(el)
        if (Array.isArray(ds)) instances.push(...ds)
      } catch {}
    }
    log.push(`scanned ${elements.length} elements, ${instances.length} instances`)
    const found = searchObjectGraph(instances, 4)
    if (!found) log.push('no Router-shaped object within four hops of any component')
    return found
  }

  /**
   * Breadth-first search for a Router through the object graph the components
   * hold. A component rarely injects the Router itself; far more often it holds
   * a service that does, so the search follows fields rather than stopping at
   * the first level.
   */
  function searchObjectGraph(roots, maxHops) {
    const seen = new Set()
    let frontier = roots.filter((o) => o && typeof o === 'object')
    for (let hop = 0; hop <= maxHops; hop += 1) {
      const next = []
      for (const obj of frontier) {
        if (seen.has(obj) || seen.size > 20000) continue
        seen.add(obj)
        if (looksLikeRouter(obj)) return obj
        for (const key of ownKeys(obj)) {
          let v
          try { v = obj[key] } catch { continue }
          if (v && typeof v === 'object' && !seen.has(v)) next.push(v)
        }
      }
      if (next.length === 0) return null
      frontier = next
    }
    return null
  }

  /**
   * Duck-types a Router: the one object in an Angular application that both
   * navigates by URL and carries the route configuration array.
   */
  function looksLikeRouter(v) {
    return !!v && typeof v === 'object'
      && typeof v.navigateByUrl === 'function'
      && Array.isArray(v.config)
  }

  /**
   * Own property names of an instance, including ones defined on its prototype,
   * since Angular stores injected dependencies as plain instance fields but a
   * subclass may expose them through accessors.
   */
  function ownKeys(o) {
    if (!o || typeof o !== 'object') return []
    const keys = new Set(Object.getOwnPropertyNames(o))
    const proto = Object.getPrototypeOf(o)
    if (proto && proto !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(proto)) keys.add(k)
    }
    return [...keys].filter((k) => k !== 'constructor')
  }

  /**
   * Joins a parent address with a child route's path the way Angular composes a
   * URL: an empty path adds no segment, and the result always starts at root.
   */
  function joinPath(parent, path) {
    const p = typeof path === 'string' ? path : null
    if (p === null) return parent === '' ? '/' : parent
    const trimmed = p.replace(/^\/+|\/+$/g, '')
    if (trimmed === '') return parent === '' ? '/' : parent
    const base = parent === '' || parent === '/' ? '' : parent
    return `${base}/${trimmed}`
  }

  /**
   * Walks a route array, records one entry per route and descends into both
   * eager children and lazily loaded subtrees. The chain set holds the arrays on
   * the current path so a self-referential configuration terminates. Both ways
   * of stopping short -- the depth ceiling and an array already on the path --
   * leave a route array unexpanded and so are declared, because the addresses
   * below the stop are ones this reading does not hold.
   */
  async function expand(routes, parentPath, chainSet, acc, depth, parentOutlet = null, parentUnderMatcher = false) {
    if (!Array.isArray(routes)) return
    if (depth > opt.maxDepth) {
      lazyFailures.push({ where: parentPath || '/', reason: 'route-depth-limit', depth })
      return
    }
    if (chainSet.has(routes)) {
      lazyFailures.push({ where: parentPath || '/', reason: 'route-array-revisited' })
      return
    }
    chainSet.add(routes)
    for (const r of routes) {
      if (!r || typeof r !== 'object') continue
      const full = joinPath(parentPath, r.path)
      // A route under one that names an outlet is reached only through that outlet, however many
      // levels down it sits and whether or not it names an outlet of its own, so the context is
      // carried rather than read off each route.
      const outlet = typeof r.outlet === 'string' ? r.outlet : parentOutlet
      // A UrlMatcher route declares its address through a function, so neither this probe nor a
      // static reader knows what it is. Composing it from the parent would file the route at the
      // parent's address, which is an address it does not answer; the flag is carried down so a
      // whole subtree beneath such a route is known to have no readable address either.
      const underMatcher = parentUnderMatcher || typeof r.matcher === 'function'
      acc.push({
        fullPath: full,
        path: typeof r.path === 'string' ? r.path : null,
        hasMatcher: typeof r.matcher === 'function',
        underMatcher,
        outlet,
        ownOutlet: typeof r.outlet === 'string' ? r.outlet : null,
        redirectTo: typeof r.redirectTo === 'string' ? r.redirectTo : null,
        component: r.component ? (r.component.name || 'anonymous') : null,
        hasLoadComponent: typeof r.loadComponent === 'function',
        hasChildren: Array.isArray(r.children),
        hasLoadChildren: typeof r.loadChildren === 'function',
        guards: (r.canActivate || []).length + (r.canActivateChild || []).length + (r.canMatch || []).length,
        depth,
      })
      if (Array.isArray(r.children)) {
        await expand(r.children, full, chainSet, acc, depth + 1, outlet, underMatcher)
      }
      if (Array.isArray(r._loadedRoutes)) {
        await expand(r._loadedRoutes, full, chainSet, acc, depth + 1, outlet, underMatcher)
      } else if (typeof r.loadChildren === 'function') {
        const loaded = await callLoadChildren(r, full)
        if (loaded) await expand(loaded, full, chainSet, acc, depth + 1, outlet, underMatcher)
      }
    }
    chainSet.delete(routes)
  }

  /**
   * Calls a route's own `loadChildren` and turns whatever it resolves to back
   * into a route array. A standalone subtree resolves to the array directly; an
   * NgModule resolves to a class whose ROUTES providers hold it.
   */
  async function callLoadChildren(route, where) {
    if (Date.now() - startedAt > opt.deadlineMs) {
      lazyFailures.push({ where, reason: 'deadline' })
      return null
    }
    let result
    try {
      result = await route.loadChildren()
    } catch (e) {
      lazyFailures.push({ where, reason: 'threw', message: String(e && e.message || e).slice(0, 200) })
      return null
    }
    const routes = routesFromLoaded(result, new Set(), 0, where)
    if (!routes) lazyFailures.push({ where, reason: 'unreadable-result', kind: describe(result) })
    return routes
  }

  /**
   * Extracts a route array from the value a `loadChildren` resolved to, which
   * Angular allows to be the array itself, an NgModule class, or a module with
   * providers. For a module it collects the ROUTES multi-provider values the way
   * Angular's own injector would, following imports transitively. `where` is the
   * address the subtree hangs under, carried only so that a stop at the depth
   * ceiling can name it: that ceiling keeps a cyclic `default` or `ngModule`
   * chain from running forever, and reaching it drops routes the merge would
   * otherwise have returned alongside the ones it did read.
   */
  function routesFromLoaded(value, visited, depth, where) {
    if (!value) return null
    if (depth > 12) {
      lazyFailures.push({ where, reason: 'module-depth-limit', depth, kind: describe(value) })
      return null
    }
    if (Array.isArray(value)) return isRouteArray(value) ? value : null
    if (typeof value === 'object' && value.default !== undefined && !value.ngModule) {
      const unwrapped = routesFromLoaded(value.default, visited, depth + 1, where)
      if (unwrapped) return unwrapped
    }
    if (typeof value === 'object' && value.ngModule) {
      const fromProviders = routesFromProviders(value.providers, visited, depth + 1, where)
      const fromModule = routesFromLoaded(value.ngModule, visited, depth + 1, where)
      return merge(fromProviders, fromModule)
    }
    if (typeof value !== 'function' && typeof value !== 'object') return null
    if (visited.has(value)) return null
    visited.add(value)
    const inj = value.ɵinj || value.ngInjectorDef
    if (!inj) return null
    let found = routesFromProviders(inj.providers, visited, depth + 1, where)
    const imports = flatten(inj.imports)
    for (const imp of imports) {
      found = merge(found, routesFromLoaded(imp, visited, depth + 1, where))
    }
    return found
  }

  /**
   * Scans a provider array for the route arrays Angular registers under its
   * ROUTES token. The token itself is not reachable by name from outside the
   * framework, so a multi provider whose value is a route array is taken as one.
   * A provider that yields nothing is a provider that carries no routes, which
   * is what almost every provider in a module is, so nothing is declared here.
   */
  function routesFromProviders(providers, visited, depth, where) {
    let found = null
    for (const p of flatten(providers)) {
      if (!p || typeof p !== 'object') continue
      if (p.multi && Array.isArray(p.useValue) && isRouteArray(p.useValue)) {
        found = merge(found, p.useValue)
      }
      if (p.ngModule) found = merge(found, routesFromLoaded(p, visited, depth + 1, where))
    }
    return found
  }

  /**
   * Recognises an array as a route array: non-empty and every element declares
   * an address or a destination the way a Route does.
   */
  function isRouteArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return false
    return arr.every((r) => r && typeof r === 'object' && (
      typeof r.path === 'string' || typeof r.matcher === 'function'
      || typeof r.redirectTo === 'string' || Array.isArray(r.children)
    ))
  }

  /** Flattens the arbitrarily nested arrays Angular allows in providers and imports. */
  function flatten(v) {
    if (!Array.isArray(v)) return v ? [v] : []
    const out = []
    for (const x of v) {
      if (Array.isArray(x)) out.push(...flatten(x))
      else if (x) out.push(x)
    }
    return out
  }

  /** Concatenates two possibly absent route arrays without losing either. */
  function merge(a, b) {
    if (!a) return b
    if (!b) return a
    return a.concat(b)
  }

  /** A short description of a value that could not be read, for the failure log. */
  function describe(v) {
    if (v === null || v === undefined) return String(v)
    if (Array.isArray(v)) return `array[${v.length}]`
    if (typeof v === 'function') return `function ${v.name || 'anonymous'}`
    return typeof v === 'object' ? `object{${Object.keys(v).slice(0, 6).join(',')}}` : typeof v
  }
}
