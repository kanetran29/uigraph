# sample-gauntlet-react — expected extraction results

An adversarial gauntlet for uigraph's react adapter. Every common navigation /
control / logic pattern of a real website, one per numbered case, with an
honest minimum bar for each. `golden.json` is the machine-readable version of
this table.

## Minimum levels

- **node** — the route node must exist in the graph with the given path.
- **must** — a definite edge with the exact `fromRoute` -> `toRoute` is required.
- **may** — at least a may-confidence edge with the given endpoints is required.
- **honest** — any honest degrade is acceptable: a may fan-out, an unknown-sink
  edge, a soundiness note, or a Tier-2 proposal. A **silent miss is a failure**.

## Route nodes

| id | pattern | source | perfect extractor | minimum | why |
|----|---------|--------|-------------------|---------|-----|
| g01a–g01h | `createBrowserRouter([...])` object config | `src/router.tsx` | nodes for `/`, `/pricing`, `/products`, `/checkout`, `/login`, `/account`, `/legacy`, `*` | node | The route table is fully static object config — no excuse to miss any node. |
| g02 | nested children + `<Outlet/>` | `src/router.tsx`, `src/pages/ProductsLayout.tsx` | `/products/:productId` node (relative `':productId'` joined onto the parent) plus the index child resolving to `/products` | node | Path joining of relative children is deterministic. |
| g03 | `React.lazy(() => import(...))` route | `src/router.tsx`, `src/pages/Help.tsx` | `/help` node linked to the lazily imported component | node | The dynamic import specifier is a string literal; laziness must not hide the node. |

## Edges

| id | pattern | source | perfect extractor | minimum | why |
|----|---------|--------|-------------------|---------|-----|
| g04 | `<Link to="/pricing">` | `Home.tsx` | must-edge `/` -> `/pricing` | must | Literal prop on the canonical router component. |
| g05 | `<NavLink to="/products">` | `Home.tsx` | must-edge `/` -> `/products` | must | Same as Link; NavLink adds only styling semantics. |
| g06 | route element `<Navigate to="/pricing" replace/>` | `src/router.tsx` | must-edge `/legacy` -> `/pricing` | must | Static redirect declared in the route table itself. |
| g07 | `navigate('/checkout')` in onClick | `Home.tsx` | must-edge `/` -> `/checkout` | must | Literal argument to the canonical hook, directly in the handler. |
| g08 | aliased navigate passed cross-file: `goCheckout(go)` calls `go('/checkout')` | `Pricing.tsx`, `src/nav-helpers.ts` | must-edge `/pricing` -> `/checkout` | honest | Requires interprocedural alias tracking across files; degrading to an unknown-sink or proposal is honest, silence is not. |
| g09 | `navigate(ROUTES.account)` from an imported `as const` map | `Pricing.tsx`, `src/routes.ts` | must-edge `/pricing` -> `/account` | may | Single property access on an imported literal const — resolvable with modest const-propagation, so at least a may-edge. |
| g10 | `navigate(PLANS[plan])`, `plan` from state | `Pricing.tsx` | may fan-out to `/products` and `/checkout` (the record's values), or an unknown-sink | honest | The key is runtime state; the honest answers are a value-set fan-out or unknown. |
| g11 | `navigate(props.returnTo)` | `ProductDetail.tsx` (`ReturnLink`) | unknown-sink edge from `/products/:productId`, ideally noting the prop's data origin | honest | Target flows through props from query-param data; statically unknowable. |
| g12a/g12b | guarded handler: `if (!loggedIn) { navigate('/login'); return } navigate('/checkout')` | `Pricing.tsx` | may-edges `/pricing` -> `/login` and `/pricing` -> `/checkout` | may | Both branches carry literal targets; conditionality caps confidence at may. |
| g13 | `{loggedIn ? <AccountPanel/> : <Navigate to="/login"/>}` | `Account.tsx` | may-edge `/account` -> `/login` | may | Literal Navigate target under a render condition. |
| g14 | `useEffect(() => { if (user) navigate('/account') }, [user])` | `Login.tsx` | edge `/login` -> `/account` flagged as state-driven (no user gesture) | honest | Fires on store change, not interaction; recognizing effect-driven nav is advanced, so any honest degrade passes. |
| g15 | handler dispatches `{type:'LOGOUT'}`; store listener in an effect calls `navigate('/')` | `Account.tsx`, `src/store.ts` | edge `/account` -> `/` attributed through the dispatch->listener chain | honest | Control flow passes through a hand-rolled pub/sub; a soundiness note or proposal is acceptable. |
| g16 | `setTimeout(() => navigate('/pricing'), 3000)` in a success-gated effect | `Checkout.tsx` | edge `/checkout` -> `/pricing` flagged as timer-driven | honest | Nested in effect + timer callback + state gate. |
| g17a | `window.location.href = 'https://external.example.com'` | `Checkout.tsx` | external-exit edge from `/checkout` | honest | Router-bypassing browser API; target external to the app. |
| g17b | `window.location.assign('/help')` | `Checkout.tsx` | edge `/checkout` -> `/help` marked as full-reload / router-bypass | honest | Internal path but outside the router's knowledge. |
| g18a | `<a href="/pricing">` | `Home.tsx` | edge `/` -> `/pricing` marked as non-router full reload | honest | Plain anchors sit outside the react-router model. |
| g18b | `<a href="https://github.com/x" target="_blank">` | `Home.tsx` | external-exit edge from `/` | honest | External anchor, new tab. |
| g19 | onSubmit awaits `fetch('/api/checkout', POST)` then `navigate('/checkout')` | `ProductDetail.tsx` | must-edge `/products/:productId` -> `/checkout` | must | The navigate argument is a plain literal; the await must not break handler-body scanning. |
| g20 | `onKeyDown`: Enter -> `navigate('/products')` | `Home.tsx` | may-edge `/` -> `/products` triggered by keyboard | may | Literal target behind a key-code condition. |
| g21 | dialog confirm navigates, cancel closes | `ProductsIndex.tsx` | must-edge `/products` -> `/checkout` from the confirm button | must | The confirm onClick is an unconditional literal navigate; the modal's conditional render doesn't change the handler. |
| g22 | `navigate(-1)` | `ProductDetail.tsx` | history-back edge from `/products/:productId` with no static target | honest | Depends on runtime history. |
| g23 | `navigate({ pathname: '/products', search: '?sort=price' })` | `ProductsIndex.tsx` | must-edge `/products` -> `/products` (self, new search) | must | Object form with a literal pathname is as static as a string literal. |
| g24 | ``navigate(`/products/${id}`)``, `id` from state | `ProductsIndex.tsx` | may-edge `/products` -> `/products/:productId` via prefix matching | may | The template prefix uniquely matches the param route; the suffix is dynamic. |
| g25 | `ProtectedRoute` children pattern wrapping `/account` | `src/ProtectedRoute.tsx`, `src/router.tsx` | may-edge `/account` -> `/login`, and `/account` still resolves to the `Account` page through the wrapper | may | Literal Navigate inside a reusable guard component; requires seeing through one wrapper layer. |

## Notes for graders

- g13 and g25 both produce `/account` -> `/login`; they are distinct mechanisms
  (inline ternary vs reusable wrapper) and an extractor that merges them into
  one edge satisfies both only if neither is silently dropped.
- `fromRoute` for cases in `ProductsIndex.tsx` is `/products` because it is the
  index child of the `/products` layout route.
- Calibration rule of thumb used throughout: literal targets -> must;
  guarded / conditional / template-prefix -> may; dynamic keys, props data,
  dispatch chains, timers, window.location, plain anchors, history back, and
  state-driven effects -> honest.
