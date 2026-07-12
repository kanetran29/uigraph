// React Router static extraction (features F2.2–F2.6). Walks a ts-morph project,
// turns <Route> declarations into nodes and Link/NavLink/Navigate/Redirect +
// useNavigate/useHistory navigations into edges, over-approximating non-literal
// targets over the declared route set and capturing guards as symbolic text.
// Supports react-router v5 and v6. No edge is emitted without a static witness.
//
// This file is the slim orchestrator: the private helpers live in focused sibling
// modules (jsx, guards, targets, effects, resolve, analyze, controls, routes) and
// this module assembles them into the public extract entry points.

import type { Node, Project, SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, Modality, SoundinessNote } from '@uigraph/core'
import type { Proposal } from '@uigraph/core'
import type { ControlInfo, RawTarget, RouteInfo } from './types'
import { edgeId, controlNodeId } from './ids'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'
import { analyzeStateNav } from './state-nav'
import { allJsxElements, jsxTag, stringAttr, within } from './jsx'
import { collectInlineRouteTargets, collectTargets, navIdentifiers } from './targets'
import { resolveComponentFile, screenSourceFiles } from './resolve'
import { collectInteractions, controlMetaFor } from './controls'
import { detectDynamicWidget, gatedOverlayVar, modalGateVar } from './effects'
import { collectRoutes, ruleIdFor } from './routes'

export { buildProject } from './resolve'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'rr-v5v6-2026.06'

/**
 * A pre-discovered route fed to extractGraphFromRoutes: the IR route path, its content-
 * addressed node id, an optional component name (for label disambiguation), and the
 * resolved page/component SourceFile. Adapters that don't use <Route> JSX (e.g. next)
 * build these from their own route source.
 */
export type RouteSeed = RouteInfo

/** The declared route that is the longest strict path-prefix parent of fullPath, or null. */
function parentRouteOf(fullPath: string, routes: RouteLike[]): RouteLike | null {
  let best: RouteLike | null = null
  for (const r of routes) {
    if (r.fullPath === fullPath || r.fullPath === '/') continue
    if (fullPath.startsWith(r.fullPath + '/') && (!best || r.fullPath.length > best.fullPath.length)) best = r
  }
  return best
}

/**
 * The source files of shared nav components rendered at the app shell — a capitalized
 * component (e.g. <Navbar/>, <Header/>) that sits in the SAME render as <Routes>/<Switch>
 * but OUTSIDE the route tree (so no route component owns it). These hold cross-screen nav
 * links the per-route scan never reaches. Router/Route/Routes/Switch and framework wrappers
 * are excluded; only in-project, resolvable components are returned.
 */
function collectShellNavFiles(project: Project): Set<SourceFile> {
  const out = new Set<SourceFile>()
  for (const sf of project.getSourceFiles()) {
    const routerEls = allJsxElements(sf).filter((el) => /^(Routes|Switch)$/.test(jsxTag(el)))
    if (routerEls.length === 0) continue
    for (const el of allJsxElements(sf)) {
      const tag = jsxTag(el).split('.')[0] ?? ''
      if (!/^[A-Z]/.test(tag)) continue
      if (/^(Route|Routes|Switch|Router|BrowserRouter|HashRouter|MemoryRouter|Provider|Consumer|Context|Fragment|Suspense|ErrorBoundary)$/.test(tag)) continue
      // Skip components rendered INSIDE the route tree — those are route screens, not shell nav.
      if (routerEls.some((r) => within(r, el))) continue
      const child = resolveComponentFile(sf, tag)
      if (child && !child.getFilePath().includes('node_modules')) out.add(child)
    }
  }
  return out
}

/** Extract a graph from an already-built ts-morph project (testable in memory). */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  return extractGraphFromRoutes(project, projectDir, collectRoutes(project), opts)
}

/**
 * The route-source-agnostic engine: assemble the full graph (route nodes + nav edges +
 * controls + modals/overlays + shared-nav attribution) from PRE-DISCOVERED route seeds.
 * The react adapter feeds it collectRoutes(<Route> JSX); the next adapter feeds it routes
 * discovered from the filesystem (app/ + pages/). `adapterName` stamps graph.meta.adapter.
 */
export function extractGraphFromRoutes(
  project: Project,
  projectDir: string,
  routes: RouteSeed[],
  opts: ExtractOptions = {},
  adapterName = '@uigraph/adapter-react',
): ExtractResult {
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))

  // Disambiguate labels: a component backing exactly one route reads best by its
  // name (Home, Checkout); a component shared across many routes (a map/SPA shell
  // like AppContent rendered by /, /explore, /could-buy…) would label every node
  // identically, so those nodes label by their route instead.
  const nameCount = new Map<string, number>()
  for (const r of routes) if (r.componentName) nameCount.set(r.componentName, (nameCount.get(r.componentName) ?? 0) + 1)
  const labelFor = (r: RouteInfo): string => (r.componentName && (nameCount.get(r.componentName) ?? 0) === 1 ? r.componentName : r.fullPath)

  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null,
    label: labelFor(r),
    kind: 'screen',
  }))

  // A component file shared by several routes is extracted ONCE, attributed to a
  // representative route node (the first declared), so a map shell rendered by ten
  // routes does not duplicate its controls/modals/navigations ten times.
  const repByFile = new Map<string, string>()
  for (const r of routes) {
    if (!r.componentFile) continue
    const fp = r.componentFile.getFilePath()
    if (!repByFile.has(fp)) repByFile.set(fp, r.nodeId)
  }
  const isRepresentative = (r: RouteInfo): boolean =>
    r.componentFile !== undefined && repByFile.get(r.componentFile.getFilePath()) === r.nodeId

  const edges: GraphEdge[] = []
  const soundiness: SoundinessNote[] = []
  const seen = new Set<string>()
  const unknownSinks = new Set<string>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: Modality, confidence: number, file: string, loc: { line: number; col: number }): void {
    const id = edgeId(from, to, t.event, t.guard)
    if (seen.has(id)) return
    seen.add(id)
    edges.push({
      id,
      from,
      to,
      event: t.event,
      guard: t.guard,
      effect: t.effect,
      modality,
      source: 'static',
      confidence,
      witness: { source: 'static', file, loc, ruleId: t.ruleId ?? ruleIdFor(t.event, t.effect) },
    })
  }

  // Surface a fully-dynamic navigation (navigate(redirectUrl), history.push(var))
  // as an `unknown`-modality edge to a per-screen "dynamic ⋯" sink, carrying the
  // symbolic target as the guard. The transition is real (the call is witnessed);
  // only its destination is undecidable — so it is recorded, never silently
  // dropped ("can be wrong but cannot be missed"), and never promoted to must.
  function pushDynamicEdge(from: string, t: RawTarget, file: string, loc: { line: number; col: number }): void {
    const sinkId = `u_${from}`
    if (!unknownSinks.has(sinkId)) {
      unknownSinks.add(sinkId)
      nodes.push({ id: sinkId, route: null, componentPath: null, label: 'dynamic ⋯', kind: 'unknown' })
    }
    const expr = t.ti.kind === 'dynamic' ? t.ti.expr : undefined
    pushEdge(from, sinkId, { ...t, guard: t.guard ?? expr ?? null, ruleId: 'rr.dynamic-target' }, 'unknown', 0.3, file, loc)
  }

  // Resolve one raw target against the declared route set and push the corresponding
  // edge(s) from `fromId`, recording soundiness for ambiguous/over-approximated/dynamic
  // cases. `descended` caps a literal match to `may` (the source's render is not
  // guaranteed). Shared by the route-component scan and the inline-JSX-route walk so
  // both resolve targets identically.
  const resolveAndPushTarget = (fromId: string, t: RawTarget, file: string, descended: boolean): void => {
    const sf = t.node.getSourceFile()
    const lc = sf.getLineAndColumnAtPos(t.node.getStart())
    const loc = { line: lc.line, col: lc.column }
    if (t.ti.kind === 'literal') {
      const { exact, candidates } = matchLiteralAll(t.ti.value, routeLikes)
      if (exact) {
        const guarded = t.guard !== null || descended
        pushEdge(fromId, exact.nodeId, t, guarded ? 'may' : 'must', guarded ? 0.6 : 1, file, loc)
      } else if (candidates.length > 0) {
        soundiness.push({ kind: 'ambiguous-target', file, loc, detail: `literal target "${t.ti.value}" matched ${candidates.length} parameterized route(s); emitted as may, never must` })
        for (const cand of candidates) pushEdge(fromId, cand.nodeId, t, 'may', 0.5, file, loc)
      } else {
        soundiness.push({ kind: 'unresolved-target', file, loc, detail: `literal target "${t.ti.value}" matches no declared route` })
      }
    } else if (t.ti.kind === 'template') {
      const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
      soundiness.push({ kind: 'over-approximation', file, loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
      for (const cand of cands) pushEdge(fromId, cand.nodeId, t, 'may', 0.5, file, loc)
    } else if (t.ti.kind === 'enum') {
      soundiness.push({ kind: 'over-approximation', file, loc, detail: `const route-map target over-approximated to ${t.ti.values.length} value(s)` })
      for (const val of t.ti.values) {
        const { exact } = matchLiteralAll(val, routeLikes)
        if (exact) pushEdge(fromId, exact.nodeId, { ...t, ti: { kind: 'literal', value: val } }, 'may', 0.5, file, loc)
      }
    } else {
      soundiness.push({ kind: 'dynamic-target', file, loc, detail: `fully dynamic navigation target (event ${t.event})` })
      pushDynamicEdge(fromId, t, file, loc)
    }
  }

  for (const route of routes) {
    if (!route.componentFile) {
      if (route.inlineElement) {
        const ie = route.inlineElement
        // Inline-JSX route: there is no component file, but the element subtree itself
        // may declare LITERAL navigations (Link/Navigate/useNavigate). Walk it and emit
        // those as static edges; a deeper nested component import is NOT followed, so the
        // honest "no component file to scan" note still stands for that residual.
        const ieSf = ie.exprNode.getSourceFile()
        const ieFile = relative(projectDir, ieSf.getFilePath())
        for (const t of collectInlineRouteTargets(ie.roots, ieSf)) resolveAndPushTarget(route.nodeId, t, ieFile, false)
        soundiness.push({ kind: 'inline-jsx-route', file: relative(projectDir, ie.file), loc: ie.loc, detail: `route ${route.fullPath} renders inline JSX <${ie.tag}> — no component file to scan for navigation` })
      } else {
        soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      }
      continue
    }
    if (!isRepresentative(route)) continue
    for (const [cf, depth] of screenSourceFiles(route.componentFile, 2)) {
      const file = relative(projectDir, cf.getFilePath())
      // A navigation in a descended child component (depth>0) is real, but the
      // child's render is not statically guaranteed — cap it to `may`, never must.
      const descended = depth > 0
      for (const t of collectTargets(cf)) resolveAndPushTarget(route.nodeId, t, file, descended)
    }
  }

  if (opts.controls) {
    let midx = 0
    let vidx = 0
    for (const route of routes) {
      if (!route.componentFile) continue
      if (!isRepresentative(route)) continue

      // Gather controls + modals across the screen's whole render tree (route
      // component + descended child components), then assign nth per identical
      // selector ACROSS the screen so control ids stay stable AND unique.
      const modalIds: string[] = []
      const modalIdByTag = new Map<string, string>()
      // Map each modal's gating state-var (showX) to its node, so a control that
      // sets that var (setShowX(true)) links to the SPECIFIC modal, not just the first.
      const modalByVar = new Map<string, string>()
      // Imported modal component files to descend into for their OWN inner controls,
      // keyed by modal node id. A modal defined INLINE (resolves to the same file, or
      // is a local function) is not recorded here — its controls are already swept by
      // the screen pass and stay screen-parented, so their content-addressed ids don't
      // shift (re-parenting them would orphan bound proposals/observations).
      const modalDescend = new Map<string, SourceFile>()
      const modalFilePaths = new Set<string>()

      type ControlItem = { el: Node; meta: ControlInfo; cf: SourceFile; navInfo: ReturnType<typeof navIdentifiers>; file: string; descended: boolean }

      // Emit a set of controls under one owner (a screen or a modal). nth is scoped
      // PER OWNER so a modal <button>Cancel</button> never perturbs a screen
      // <button>Cancel</button>'s nth (hence id). forceMay caps every navigation to
      // `may` (a modal's contents are conditionally rendered, never guaranteed to
      // mount). linkModals wires open:modal effects to the screen's modals — done only
      // for screen-level controls, since nested-modal targets aren't modelled in v1.
      const emitControls = (ownerId: string, items: ControlItem[], forceMay: boolean, linkModals: boolean): void => {
        const nthBySig = new Map<string, number>()
        for (const { meta } of items) {
          const sig = `${meta.selector.strategy}|${meta.selector.value}`
          const nth = nthBySig.get(sig) ?? 0
          nthBySig.set(sig, nth + 1)
          if (nth > 0) meta.selector.nth = nth
        }
        for (const { el, meta, cf, navInfo, file, descended } of items) {
          const isDescended = descended || forceMay
          const cId = controlNodeId(ownerId, meta.selector)
          const inter = collectInteractions(el, cf, navInfo)
          // The state-var is needed only for edge targeting; normalize the stored
          // effect to the stable 'open:modal' so the IR doesn't leak variable names.
          const nodeEffects = [...new Set(inter.effects.map((e) => (e.startsWith('open:modal') ? 'open:modal' : e)))]
          const lc = cf.getLineAndColumnAtPos(el.getStart())
          const loc = { line: lc.line, col: lc.column }
          // A handler that dispatch()es a redux/store action is a navigation INTENT we
          // cannot soundly follow: the route change (if any) happens in a reducer/middleware,
          // off the static AST. Record an honest note instead of inventing an edge.
          if (inter.effects.includes('state:dispatch')) {
            soundiness.push({ kind: 'dispatch-driven-nav', file, loc, detail: `${meta.name ?? meta.element} dispatches a store action; any resulting navigation is not statically extractable` })
          }
          for (const nav of inter.navs) {
            const ctxGuard = nav.ctx === 'success' ? 'onSuccess' : nav.ctx === 'error' ? 'onError' : null
            const guard = nav.guard ?? ctxGuard
            // A control in a descended child / a modal is real but not guaranteed to render here -> cap to may.
            const modality: 'must' | 'may' = guard !== null || isDescended ? 'may' : 'must'
            const confidence = isDescended ? 0.5 : nav.ctx === 'error' ? 0.5 : nav.ctx === 'success' ? 0.7 : guard !== null ? 0.6 : 1
            const ruleId = nav.interprocedural ? 'rr.use-navigate.interprocedural' : undefined
            if (nav.ti.kind === 'literal') {
              const { exact, candidates } = matchLiteralAll(nav.ti.value, routeLikes)
              if (exact) {
                pushEdge(cId, exact.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, modality, confidence, file, loc)
              } else {
                for (const cand of candidates)
                  pushEdge(cId, cand.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard: guard ?? 'ambiguous', ruleId }, 'may', 0.5, file, loc)
              }
            } else if (nav.ti.kind === 'template') {
              for (const cand of matchPrefix(nav.ti.staticPrefix, routeLikes))
                pushEdge(cId, cand.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, 'may', Math.min(confidence, 0.5), file, loc)
            } else {
              pushDynamicEdge(cId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, file, loc)
            }
          }

          // Dismiss-then-navigate: a handler that calls a modal setter with literal false
          // emits a close:modal edge BACK to the containing screen, in ADDITION to any
          // navigate() the same handler performs (emitted above) — one handler, multiple
          // edges. The target is the screen the modal lives on; closing returns there.
          // The edge id keys on (control id, screen, event) so it is stable across re-maps.
          if (inter.effects.includes('close:modal')) {
            const ev = inter.events[0] ?? 'click'
            pushEdge(cId, route.nodeId, { ti: { kind: 'literal', value: route.nodeId }, event: ev, effect: 'close:modal', node: el, guard: null, ruleId: 'rr.modal-close' }, isDescended ? 'may' : 'must', isDescended ? 0.6 : 1, file, loc)
          }

          // Link each modal-opening effect to the SPECIFIC modal it shows (matched by the
          // state var setShowX -> showX -> the modal gated by showX). The precise gate-var
          // match is deterministic and allowed for ANY control — including one nested inside
          // another overlay (refapp opens its login modal from controls deep in the buy/sell
          // flow). The sole-modal FALLBACK is a guess, so only screen-level controls
          // (linkModals) may use it — a nested control could mislink across unrelated overlays.
          for (const eff of inter.effects) {
            if (!eff.startsWith('open:modal')) continue
            const v = eff.slice('open:modal:'.length)
            const modalTarget = modalByVar.get(v) ?? (linkModals && modalIds.length === 1 ? modalIds[0] : undefined)
            // A control never "opens" the overlay it already lives in.
            if (modalTarget === undefined || modalTarget === ownerId) continue
            const ev = inter.events[0] ?? 'click'
            pushEdge(cId, modalTarget, { ti: { kind: 'dynamic' }, event: ev, effect: 'open:modal', node: el, guard: null }, isDescended ? 'may' : 'must', isDescended ? 0.5 : 1, file, loc)
          }

          nodes.push({
            id: cId,
            route: null,
            componentPath: file,
            label: meta.name ?? meta.element,
            kind: 'control',
            parent: ownerId,
            control: {
              element: meta.element,
              controlType: meta.controlType,
              selector: meta.selector,
              loc,
              ...(meta.input ? { input: meta.input } : {}),
              ...(meta.name ? { name: meta.name } : {}),
              ...(inter.events.length > 0 ? { events: inter.events } : {}),
              ...(nodeEffects.length > 0 ? { effects: nodeEffects } : {}),
            },
          })
        }
      }

      // Gather controls from a file set (route tree or modal tree), capturing each
      // control's element + descent depth so the emitter can cap deep controls to may.
      const gatherControls = (files: Map<SourceFile, number>, skip?: Set<string>): ControlItem[] => {
        const out: ControlItem[] = []
        for (const [cf, depth] of files) {
          if (skip?.has(cf.getFilePath())) continue
          const file = relative(projectDir, cf.getFilePath())
          const navInfo = navIdentifiers(cf)
          if (depth === 0 && detectDynamicWidget(cf)) {
            soundiness.push({ kind: 'dynamic-widget', file, detail: 'interactive map/canvas widget: gestures (zoom/pan/drag) are runtime-only and not statically modelable' })
          }
          for (const el of allJsxElements(cf)) {
            const meta = controlMetaFor(el)
            if (meta) out.push({ el, meta, cf, navInfo, file, descended: depth > 0 })
          }
        }
        return out
      }

      // Shallower for controls: depth 1 catches direct-child buttons (a landing page's
      // could-sell/could-buy) without pulling every control from deep shared components.
      const screenFiles = screenSourceFiles(route.componentFile, 1)

      // Pass 1: detect modals + resolve each imported modal's own component file.
      for (const [cf] of screenFiles) {
        const file = relative(projectDir, cf.getFilePath())
        for (const el of allJsxElements(cf)) {
          const tag = jsxTag(el)
          if (!/(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag)) continue
          let mId = modalIdByTag.get(tag)
          if (mId === undefined) {
            mId = `m_${route.nodeId}_${midx++}`
            modalIdByTag.set(tag, mId)
            modalIds.push(mId)
            nodes.push({ id: mId, route: null, componentPath: file, label: stringAttr(el, 'title') ?? tag, kind: 'modal' })
            const base = tag.split('.')[0] ?? tag
            const mFile = resolveComponentFile(cf, base)
            if (mFile && mFile.getFilePath() !== cf.getFilePath()) {
              modalDescend.set(mId, mFile)
              modalFilePaths.add(mFile.getFilePath())
            }
          }
          // Every render of the modal (even same tag, e.g. couldSell + couldBuy) may
          // carry a distinct gating var -> all map to the one deduped modal node.
          const gate = modalGateVar(el)
          if (gate !== null) modalByVar.set(gate, mId)
        }
      }

      // Pass 1b: detect state-gated overlay sub-views — a capitalized IMPORTED component
      // gated by a *Visible state var (e.g. {profileViewVisible && <ProfileView/>}). These
      // are overlay surfaces just like modals, but tagged by convention not suffix. Kept
      // entirely separate from the modal pass — a distinct `mv_` id namespace + counter so
      // adding a view never perturbs an existing modal's positional `m_<route>_<midx>` id,
      // and they are NOT added to modalIds (they are not opened via a setShow* fallback).
      const viewIdByTag = new Map<string, string>()
      for (const [cf] of screenFiles) {
        const file = relative(projectDir, cf.getFilePath())
        for (const el of allJsxElements(cf)) {
          const tag = jsxTag(el)
          const base = tag.split('.')[0] ?? tag
          if (/(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag)) continue
          if (!/^[A-Z]/.test(base) || gatedOverlayVar(el) === null) continue
          const vFile = resolveComponentFile(cf, base)
          if (!vFile || vFile.getFilePath() === cf.getFilePath()) continue
          if (modalFilePaths.has(vFile.getFilePath()) || viewIdByTag.has(tag)) continue
          const vId = `mv_${route.nodeId}_${vidx++}`
          viewIdByTag.set(tag, vId)
          nodes.push({ id: vId, route: null, componentPath: file, label: tag, kind: 'modal' })
          modalDescend.set(vId, vFile)
          modalFilePaths.add(vFile.getFilePath())
        }
      }

      // Pass 2: screen controls — skipping files owned by a descended overlay (their
      // controls belong to the overlay node, emitted in pass 3).
      emitControls(route.nodeId, gatherControls(screenFiles, modalFilePaths), false, true)

      // Pass 3: per imported overlay, descend its own component tree (depth 1 reaches an
      // overlay that delegates to a child, e.g. SignupLoginModal -> LoginOrSignup) and
      // emit its controls under the overlay node, every nav capped to may. Each descent
      // skips the OTHER overlays' root files so a nested overlay's controls are emitted
      // once (under that nested overlay's own pass), never double-counted.
      const overlayRoots = new Set([...modalDescend.values()].map((f) => f.getFilePath()))
      for (const [mId, mFile] of modalDescend) {
        const skip = new Set([...overlayRoots].filter((p) => p !== mFile.getFilePath()))
        emitControls(mId, gatherControls(screenSourceFiles(mFile, 1), skip), true, false)
      }
    }
  }

  // Shared root-level navs: a <Navbar/>/<Header/> rendered as a SIBLING of <Routes>/
  // <Switch> at the app shell (not inside any <Route>, so no route component renders it).
  // Its links are reachable from every screen, so they are attributed to a single synthetic
  // app-shell node (kind 'screen', since the IR has no app-nav kind) as `may`-edges. Only
  // runs when such a shell nav exists, so apps without one are unaffected.
  const shellNavFiles = collectShellNavFiles(project)
  if (shellNavFiles.size > 0) {
    const shellId = 'app_nav'
    let shellCreated = false
    for (const navFile of shellNavFiles) {
      for (const [cf] of screenSourceFiles(navFile, 1)) {
        const file = relative(projectDir, cf.getFilePath())
        for (const t of collectTargets(cf)) {
          const targets: RouteLike[] = []
          if (t.ti.kind === 'literal') {
            const { exact, candidates } = matchLiteralAll(t.ti.value, routeLikes)
            if (exact) targets.push(exact)
            else targets.push(...candidates)
          } else if (t.ti.kind === 'template') {
            targets.push(...matchPrefix(t.ti.staticPrefix, routeLikes))
          } else if (t.ti.kind === 'enum') {
            for (const v of t.ti.values) {
              const { exact } = matchLiteralAll(v, routeLikes)
              if (exact) targets.push(exact)
            }
          }
          if (targets.length === 0) continue
          if (!shellCreated) {
            shellCreated = true
            nodes.push({ id: shellId, route: null, componentPath: relative(projectDir, navFile.getFilePath()), label: 'app nav', kind: 'screen' })
          }
          const lc = cf.getLineAndColumnAtPos(t.node.getStart())
          const loc = { line: lc.line, col: lc.column }
          for (const hit of targets) pushEdge(shellId, hit.nodeId, { ...t, ruleId: 'rr.shell-nav' }, 'may', 0.5, file, loc)
        }
      }
    }
  }

  // Shared/context navigations: a nav in a NON-route file (context/hook) to a nested
  // sub-route is attributed to that route's declared parent as `may`, witnessed by the
  // call — e.g. a profile context's push(subviewPaths[sv]) / push('/profile/x')
  // connects /profile -> /profile/sell-listings, which no route component renders.
  const routeFilePaths = new Set<string>(routes.flatMap((r) => (r.componentFile ? [String(r.componentFile.getFilePath())] : [])))
  for (const sf of project.getSourceFiles()) {
    if (routeFilePaths.has(String(sf.getFilePath()))) continue
    for (const t of collectTargets(sf)) {
      const lc = sf.getLineAndColumnAtPos(t.node.getStart())
      const loc = { line: lc.line, col: lc.column }
      const file = relative(projectDir, sf.getFilePath())
      // Resolve the call's target(s) to declared routes: literal/enum -> exact match;
      // template (`/profile/price-estimations/${id}`) -> prefix candidates.
      const hits: RouteLike[] = []
      if (t.ti.kind === 'literal') {
        const { exact } = matchLiteralAll(t.ti.value, routeLikes)
        if (exact) hits.push(exact)
      } else if (t.ti.kind === 'enum') {
        for (const v of t.ti.values) {
          const { exact } = matchLiteralAll(v, routeLikes)
          if (exact) hits.push(exact)
        }
      } else if (t.ti.kind === 'template') {
        hits.push(...matchPrefix(t.ti.staticPrefix, routeLikes))
      }
      for (const hit of hits) {
        const parent = parentRouteOf(hit.fullPath, routeLikes)
        if (!parent) continue
        pushEdge(parent.nodeId, hit.nodeId, { ...t, ti: { kind: 'literal', value: hit.fullPath }, ruleId: 'rr.shared-nav' }, 'may', 0.5, file, loc)
      }
    }
  }

  // State-driven nav: Tier-2 PROPOSALS for enum-state "screens" (quarantined, never
  // base edges) plus soundiness notes for helper/call-derived (dynamic) assignments.
  // Proposals attach to the first real screen node so they materialize into the
  // proposal graph; their ids derive only from (state-var, value) and so are
  // re-map-stable regardless of that anchor.
  const stateNav = analyzeStateNav(project, projectDir)
  soundiness.push(...stateNav.soundiness)
  const anchorScreen = nodes.find((n) => n.kind === 'screen')?.id
  const proposals: Proposal[] = anchorScreen === undefined ? [] : stateNav.proposals.map((p) => ({ ...p, screen: anchorScreen }))

  const graph = {
    version: 0 as const,
    meta: {
      adapter: adapterName,
      adapterVersion: ADAPTER_VERSION,
      rulesetVersion: opts.rulesetVersion ?? DEFAULT_RULESET,
      ...(opts.commit ? { commit: opts.commit } : {}),
    },
    nodes,
    edges,
  }
  return { graph, soundiness, ...(proposals.length > 0 ? { proposals } : {}) }
}

export { ADAPTER_VERSION, DEFAULT_RULESET }
