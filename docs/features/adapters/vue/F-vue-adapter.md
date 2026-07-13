# New Vue adapter (@ui-graph/adapter-vue) + sample app

- **Slug:** F-vue-adapter
- **Status:** designed

## Purpose

Add Vue 3 support to uigraph at parity with the React/Angular adapters: a new packages/adapter-vue implementing the core Adapter contract (packages/core/src/adapter.ts, name 'vue') that statically extracts the shared IR (packages/core/src/ir.ts) from a Vue + Vue Router project — route nodes from a routes array, navigation edges from <router-link>/router.push|replace, and (with opts.controls) control nodes from .vue SFC <template> blocks — plus a golden examples/sample-vue-app mirroring sample-react-app's screens, and CLI wiring (pickAdapter, --adapter docs). The golden invariant holds exactly as in React/Angular: every emitted edge is source:'static' with a deterministic witness; non-literal targets over-approximate to may/unknown; nothing becomes must without an exact literal match into an unguarded route. Reuses core types (controlNodeId scheme, ControlSelector, ControlInput) — does not redefine them — and adds NO new core type. Deliberately avoids a heavy Vue-compiler dep (KISS): SFC split + template scan via string/regex in src/sfc.ts (the same string-parse approach adapter-angular uses for inline templates), ts-morph for the <script> + routes array.

## Design

PACKAGE LAYOUT (mirror adapter-angular exactly):
- packages/adapter-vue/package.json: name '@ui-graph/adapter-vue', type module, exports './src/index.ts', scripts typecheck (tsc --noEmit) + test (vitest run --passWithNoTests), deps @ui-graph/core workspace:* + ts-morph catalog:, devDeps typescript/vitest/@types/node catalog:. Copy adapter-angular/package.json verbatim, swap the name.
- packages/adapter-vue/tsconfig.json: { extends ../../tsconfig.base.json, include [src] } — identical to adapter-angular/tsconfig.json.
- src/ids.ts: COPY adapter-react/src/ids.ts verbatim (it already imports ControlSelector + fnv1a from @ui-graph/core and exports controlNodeId, routeToNodeId, edgeId). Reuse, do not invent.
- src/matcher.ts: COPY adapter-react/src/matcher.ts verbatim (matchLiteralAll {exact,candidates} + matchPrefix + RouteLike). React's two-result matcher is the right one because control->nav fan-out needs candidates.
- src/index.ts: mirror adapter-angular/index.ts — detectVue (package.json deps include 'vue'/'vue-router', else shallow source scan for 'vue-router' / createRouter), extractVue(dir,opts,ctx) builds the project and calls extractGraph, logs counts; export const vueAdapter:Adapter={name:'vue',detect:detectVue,extract:extractVue}; re-export buildProject/extractGraph/ids/matcher.
- src/sfc.ts: the ONLY genuinely new logic. src/extract.ts: parallels adapter-angular/extract.ts + reuses adapter-react's handler/guard analysis.

SFC PARSING (src/sfc.ts, no @vue/compiler-sfc):
splitSfc(source) -> { template, templateOffset, script, scriptOffset, lang, setup }. Find the ROOT <template> and <script>/<script setup> blocks by scanning for top-level <template ...> ... </template> with a depth counter (Vue allows nested <template v-if> inside the root, so count opening/closing <template> tags to find the matching close — NOT a greedy regex). Read lang from <script lang="ts"> and setup from the presence of 'setup' on the script tag. <style> ignored. Offsets recorded so witness line/col map back into the .vue file (use ts-morph's getLineAndColumnAtPos on the virtual script for script-side; for template-side compute line/col by counting newlines from templateOffset to the match index — pin with a loc test).
parseTemplateElements(template, baseOffset) -> TemplateEl[] { tag, attrs:Map<rawName,value>, text, offset }. A small tag tokenizer: walk the string, for each <tag ... > or <tag .../> capture the tag name and the raw attribute span; parse attributes into a Map keyed by the RAW name (so ':to', 'v-bind:to', '@click', 'v-on:click.prevent', 'data-testid' are all distinct keys); capture inner text up to the matching close tag for text-bearing tags (button/a). Self-closing handled. Helpers: stringAttr(el,'to') (plain attr), boundAttr(el,'to') (':to' or 'v-bind:to' -> the JS expression string), eventHandlers(el) -> EventHandler[] from '@x'/'v-on:x' keys with .modifiers stripped from the event name, value = handler expression text.

TS-MORPH BRIDGE (buildProject in src/extract.ts): ts-morph can't read .vue, so glob `${dir}/src/**/*.{ts,js}` AND `**/*.vue`; for each .vue, splitSfc it and project.createSourceFile('<vuePath>.script.ts', sfc.script) so router calls + route-array imports + methods resolve cross-file. Keep a Map<virtualScriptPath,{vuePath,sfc}> so extractGraph recovers each component's .vue path, template string, and offsets. RESOLVE_EXTS gains '.vue','/index.vue'; a resolved .vue maps back to its virtual script for in-component script analysis. For the golden, buildProject reads .vue via node fs; for in-memory unit tests, expose extractFromSources(files) that does the same split+register (the analogue of Angular test's inMemory(files)).

ROUTES (src/extract.ts, parallels adapter-angular collectRoutes): findRouteObjects walks ts-morph for (a) the array passed to createRouter({ routes:[...] }) — read the 'routes' property's ArrayLiteral; (b) createRouter(routesIdent) where routesIdent resolves to `const routes = [...]` (incl. a routes.ts); (c) any array of objects with a 'path' property (Angular's looksLikeRoutes heuristic). Each route object: stringProp 'path', identifierProp/lazy-import 'component' (`Home` or `() => import('./Home.vue')`), stringProp 'name' (for :to={name}), nested 'children' array -> recurse joining parent+child path (normalizeRoutePath: '' -> '/', '/x' absolute, child relative joined). beforeEnter property (function/ident) -> guards:[name]. routeToNodeId reused. Build screen GraphNodes exactly like Angular (id, route, componentPath relative to .vue, label = componentName||fullPath, kind 'screen').

NAV EDGES: (1) <router-link to|:to> and <RouterLink>: event 'click:router-link', ruleId vue.router-link; classify to= (literal string) vs :to= via classifyBoundExpr (literal-only -> literal; `'/x/'+id` or template literal -> template prefix; {name:'x'} literal -> resolve via name map; else dynamic) — mirrors Angular classifyBoundLink + React classifyTarget. (2) router.push/replace + this.$router.push/replace: routerVars(sf) collects idents bound to useRouter(); a CallExpression on such an ident's .push/.replace (or this.$router.push) -> event 'navigate', effect router.push|replace, ruleId vue.router-push|replace; arg0 classified by the shared classifyTarget (string/template/dynamic). guard via the COPIED getGuard + extraConditionGuard from adapter-react/extract.ts (reuse: copy those framework-agnostic functions — they take generic ts-morph Node — into a small shared spot in extract.ts). Literal exact into unguarded route -> must (conf 1); exact into guarded route or under a condition -> may (0.6); template -> matchPrefix may (0.5) + over-approximation note; dynamic -> u_<from> unknown sink (0.3) + dynamic-target note (reuse React pushDynamicEdge shape). Unresolved literal -> unresolved-target note, no edge.

CONTROLS (opts.controls, parallels adapter-react two-pass loop): for each representative screen .vue, scan parseTemplateElements; controlMetaFor classifies button/input/textarea/select/form, contenteditable, and ANY lowercase tag carrying @event/v-on (so <div @click> counts) — same rule as React controlMetaFor. controlType from tag/input-type (inputControlType: checkbox/radio->checkbox, submit/button->button, file->file else input). controlSelector with the SHARED precedence data-testid -> role+name -> id/name -> text -> structural (port React controlSelector + ariaRole; accName from aria-label/name/placeholder/text/id; testid from data-testid). inputConstraints (type/required/pattern; 'required' present as a bare attr). Two-pass nth assignment per identical selector signature, then controlNodeId(route.nodeId, selector) — identical to React lines 976-990, guaranteeing stable+unique ids. events = distinct @event names. CONTROL->NAV: for each @event, resolve its handler expression: inline `router.push('/x')` parsed directly; a method name -> resolveFunctionNode in <script setup> (top-level const arrow/function) OR Options-API methods:{} (a MethodDeclaration/property on the methods object) -> run the COPIED analyzeHandler/walkReachable reachable-call-graph walk (reuse React's interprocedural analysis incl. detectApiEffect/detectStateEffect/branchContextOf) to find router.push sinks + effects. Emit edges FROM the control node (kind 'control', parent screen) to the resolved route, with success/error-branch + guard downgrading to may exactly as React lines 994-1014. @submit on <form> handled the same.

WITNESS/META: meta.adapter '@ui-graph/adapter-vue', adapterVersion '0.1.0', DEFAULT_RULESET 'vue-v3-2026.06'. ruleIds: vue.router-link, vue.router-push, vue.router-replace, vue.router-push.interprocedural, vue.dynamic-target. Every edge source 'static', witness {source:'static', file (relative .vue path), loc, ruleId}.

SAMPLE APP (examples/sample-vue-app, mirror sample-react-app screens): main.ts (createApp+router), router.ts (createRouter with createWebHistory and routes array: '/'->Home, '/login'->Login, '/dashboard'->Dashboard (beforeEnter auth), '/dashboard/settings'->Settings via children, '/products'->Products, '/products/:id'->ProductDetail, '/checkout'->Checkout (guarded), '/showcase'->Showcase, '/:pathMatch(*)*'->NotFound), auth.ts. SFCs: Home.vue (<router-link to>s, must edges), Login.vue (<script setup> button @click=submit; submit() useRouter().push('/dashboard') -> guarded may + control edge), Products.vue (v-for <router-link :to=`/products/${id}`> template may + a button @click method), ProductDetail.vue (router.push('/checkout')), Checkout.vue (router.push('/') on success), Dashboard.vue + Settings.vue (cross links), Showcase.vue (the exhaustive native-control + @event spread mirroring React Showcase.tsx — every input type, checkbox/radio with distinct nth, textarea, select, contenteditable, form @submit, custom @click div, file input), NotFound.vue (link home). Use <script setup> as primary; make ONE component (e.g. Dashboard.vue) Options-API with methods:{} + this.$router to exercise that path. package.json (vue+vue-router devDeps so it's a real buildable app), tsconfig.json, vite.config.ts, index.html — copy sample-react-app's shapes.

CLI WIRING: commands.ts — import { vueAdapter } from '@ui-graph/adapter-vue'; widen AdapterName to 'react'|'angular'|'vue'; pickAdapter adds `if (name === 'vue') return vueAdapter`; fix the throw message to list react/angular/vue. cli.ts — map command's --adapter description -> 'adapter to use: react | angular | vue'. cli/package.json — add @ui-graph/adapter-vue workspace:* dependency.

DATA SHAPES: REUSE core ControlSelector{strategy,value,nth?}, ControlInput{type?,required?,pattern?}, ControlMeta, GraphNode, GraphEdge, Modality, ExtractResult{graph,soundiness}, SoundinessNote, Adapter, AdapterContext, ExtractOptions — unchanged. controlNodeId copied (already core-typed). New internal types only: Sfc{template,templateOffset,script,scriptOffset,lang,setup}, TemplateEl{tag,attrs:Map,text,offset}, EventHandler{event,exprText}, and the React/Angular-parallel TargetInfo / RouteInfo{...,guards,name?} / RawTarget / ControlInfo (private to adapter-vue). u_<from> unknown sinks + controlNodeId control ids exactly as React.

SOUNDNESS: must ONLY for exact literal -> unguarded route with getGuard+extraConditionGuard null; bound/:to/template/concat -> matchPrefix may + over-approximation note; fully dynamic (:to=var, push(var), {name:var}) -> single unknown edge to u_<from> 'dynamic ⋯' sink carrying symbolic expr as guard + dynamic-target note (recorded never dropped, never promoted — React's pushDynamicEdge rule); beforeEnter/global guards make navs INTO the route may with guard name; control->nav success/error branch context downgrades confidence + forces may; unresolved component -> unresolved-component note; unparsed SFC -> 'unparsed-sfc' note rather than guessing. The string template parser's failure mode is UNDER-extraction + a note, never a phantom must, because every must requires an exact literal match into the bounded declared-route set.

CONTRACT/BOUNDARY: framework-specific code (SFC split, template scan, Vue Router idioms) lives entirely in adapter-vue; core stays framework-agnostic; only generic services used are ctx.readFile + ctx.log per AdapterContext. extractGraph is pure/in-memory-testable (parallels angular/react). No core type added or changed — purely additive.

RISKS: (1) hand-rolled SFC/template parser less robust than @vue/compiler-sfc for pathological templates (multiline attrs, '>' inside attr strings, comments, nested <template>, slots) — mitigate with a depth-counted tokenizer + explicit edge-case tests; failure mode is under-extraction, never a phantom must; the sfc.ts interface (splitSfc/parseTemplateElements) is a seam so @vue/compiler-sfc can be swapped in later WITHOUT touching extract.ts if a real app breaks it — revisit the no-compiler decision only with that evidence. (2) ts-morph virtual-script bridge: relative imports must resolve across virtual scripts AND .vue (mitigate with .vue-aware resolver + lazy-import test); offset math is error-prone (pin with a loc-correctness test). (3) Options API vs <script setup> doubles method resolution (methods:{}/this.$router vs top-level fns/useRouter()) — support both via shared analyzeHandler, golden-test both styles. (4) golden edge-count brittleness (like Angular's pinned 11/6/5): author the fixture minimal+explicit, run once, freeze counts. (5) scope creep on effects/modals: control->nav + api: effects in-scope; Vue modal-node + state:/Pinia analysis is best-effort/deferrable (YAGNI) and never affects must/may soundness.

## Test strategy

TDD, tests FIRST, mirroring packages/adapter-angular/src/extract.test.ts and adapter-react/src/extract.test.ts.

UNIT src/sfc.test.ts (the novel logic): splitSfc separates <template> and <script>/<script setup>, captures offsets, reads lang + setup flag; handles template-only SFC, nested <template v-if> inside root (depth counter picks root), <style> ignored. parseTemplateElements: one record per element with plain + ':' + '@'/'v-on:' attrs by raw key, nested + self-closing (<input .../>) elements, text for button/anchor. Helpers stringAttr/boundAttr/eventHandlers strip .modifiers, read :to / v-bind:to / @click / v-on:click. A loc-correctness test asserts a computed template line/col maps to the right source position.

UNIT src/matcher.test.ts + src/ids.test.ts: copy adapter-react's (matchLiteralAll exact vs param candidates, matchPrefix; controlNodeId stable under nth + distinct ids, routeToNodeId, edgeId).

IN-MEMORY EXTRACTION src/extract.test.ts via extractFromSources(files) (analogue of Angular inMemory(files), but splits each .vue with splitSfc and registers the script): createRouter({routes:[...]}) yields route nodes; createRouter(routes) with a separate const routes array found; nested children join paths to n_dashboard_settings; ()=>import('./Login.vue') resolves componentPath; <router-link to="/login"> into unguarded -> must, into beforeEnter-guarded -> may with guard text; :to=`/products/${id}` -> may over matchPrefix + over-approximation note; :to="var" / push(var) -> unknown edge to u_<from> + dynamic-target note, never must; router.push('/dashboard') via useRouter() var -> edge; this.$router.push in Options-API method -> edge; push inside if(ok) -> may, unconditional -> must; control->nav: @click="submit" where submit() pushes -> edge FROM control to route, inline @click="router.push('/x')" captured, <form @submit> calling push -> edge; controls precedence (testid wins; <button>text</button> -> role-name button|text; identical radios distinct nth+ids; bare <div @click> structural; input type/required/pattern; v-model field still a control); golden invariant: every edge source==='static', witness.source==='static', witness.ruleId matches /^vue\./, validateGraph(graph)===[] (import from @ui-graph/core like Angular test line 18); route graph identical with/without opts.controls.

GOLDEN src/extract.test.ts describe('sample-vue-app golden'): build over examples/sample-vue-app via fileURLToPath (like Angular test lines 13-15), buildProject registers .vue scripts. Assert: validateGraph===[]; exact route-node id set {n_root,n_login,n_dashboard,n_dashboard_settings,n_products,n_products_id,n_checkout,n_showcase,n_wildcard} mirroring App.tsx; a pinned edge count + must/may/unknown split frozen after authoring (the Angular toHaveLength(11) + 6/5 pattern); specific edges n_root->n_login must, n_login->n_dashboard may (guarded), n_products->n_products_id may (template :to), control edges from Login button + Showcase form; every edge has a static witness + vue. ruleId; with controls:true controls exist, each parent is a real screen node, Showcase yields the full native-control spread (file input present, distinct nth radios), route graph unchanged vs controls:false.

No new test runner — vitest run, package.json test script as in adapter-angular.

## Files

- `packages/adapter-vue/package.json`
- `packages/adapter-vue/tsconfig.json`
- `packages/adapter-vue/src/index.ts`
- `packages/adapter-vue/src/extract.ts`
- `packages/adapter-vue/src/sfc.ts`
- `packages/adapter-vue/src/ids.ts`
- `packages/adapter-vue/src/matcher.ts`
- `packages/adapter-vue/src/sfc.test.ts`
- `packages/adapter-vue/src/extract.test.ts`
- `packages/adapter-vue/src/matcher.test.ts`
- `packages/adapter-vue/src/ids.test.ts`
- `examples/sample-vue-app/package.json`
- `examples/sample-vue-app/tsconfig.json`
- `examples/sample-vue-app/vite.config.ts`
- `examples/sample-vue-app/index.html`
- `examples/sample-vue-app/src/main.ts`
- `examples/sample-vue-app/src/router.ts`
- `examples/sample-vue-app/src/auth.ts`
- `examples/sample-vue-app/src/pages/Home.vue`
- `examples/sample-vue-app/src/pages/Login.vue`
- `examples/sample-vue-app/src/pages/Dashboard.vue`
- `examples/sample-vue-app/src/pages/Settings.vue`
- `examples/sample-vue-app/src/pages/Products.vue`
- `examples/sample-vue-app/src/pages/ProductDetail.vue`
- `examples/sample-vue-app/src/pages/Checkout.vue`
- `examples/sample-vue-app/src/pages/Showcase.vue`
- `examples/sample-vue-app/src/pages/NotFound.vue`
- `packages/cli/src/commands.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/package.json`

## Dependencies

- @ui-graph/core (workspace:*) — IR types (ControlSelector, ControlInput, GraphNode, GraphEdge, Modality, ExtractResult, SoundinessNote, Adapter, AdapterContext, ExtractOptions), fnv1a (ids), validateGraph (tests). Existing workspace package.
- ts-morph (catalog: ^28.0.0) — parses each .vue <script>/<script setup> block + the routes-array .ts: router.push/replace, routes object literals, method bodies, guard conditions. Same dep React/Angular use; NO new version.
- vitest + typescript + @types/node (catalog:) — devDeps identical to the other adapters.
- NO @vue/compiler-sfc / @vue/compiler-dom — deliberately avoided per the KISS constraint; SFC split + template scan done with string/regex in src/sfc.ts, the same approach adapter-angular uses for inline templates (extract.ts STATIC_LINK_RE/BOUND_LINK_RE). Swap-in is possible later behind the sfc.ts seam if a real app breaks the parser.
- examples/sample-vue-app devDeps vue + vue-router — only so the fixture is a real buildable Vue app; the adapter never imports them (reads source statically).
- pnpm-workspace.yaml already globs packages/* + examples/* — both new dirs picked up with NO config change.
- packages/cli/package.json gains @ui-graph/adapter-vue (workspace:*) so pickAdapter can import it.
