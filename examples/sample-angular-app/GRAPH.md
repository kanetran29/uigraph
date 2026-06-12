# sample-angular-app — known UI graph (golden fixture)

This standalone-components Angular app is parsed **statically** by
`@uigraph/adapter-angular`. It is not built or run; ts-morph reads the `Routes`
array in `src/app.routes.ts` and the inline `@Component` templates / `Router`
calls in each component file. The graph below is the adapter's expected output
and is asserted in `packages/adapter-angular/src/extract.test.ts`.

## Routes → nodes (8)

| path                  | node id               | component               | guard       |
| --------------------- | --------------------- | ----------------------- | ----------- |
| `''`                  | `n_root`              | `HomeComponent`         | —           |
| `login`               | `n_login`             | `LoginComponent`        | —           |
| `dashboard`           | `n_dashboard`         | `DashboardComponent`    | `AuthGuard` |
| `dashboard/settings`  | `n_dashboard_settings`| `SettingsComponent`     | `AuthGuard` |
| `products`            | `n_products`          | `ProductsComponent`     | —           |
| `products/:id`        | `n_products_id`       | `ProductDetailComponent`| —           |
| `checkout`            | `n_checkout`          | `CheckoutComponent`     | `AuthGuard` |
| `**`                  | `n_wildcard`          | `NotFoundComponent`     | —           |

`''` normalizes to route `/` (node `n_root`); `**` normalizes to route `/*`
(node `n_wildcard`).

## Navigations → edges (11)

Modality rule: an edge into a route guarded by `canActivate` is **may** (the
guard can block entry) and carries the guard class names as symbolic text, even
for a literal target. A literal target into an **unguarded** route is **must**.
An over-approximated (bound, non-literal) target is **may**.

### must (6) — literal target into an unguarded route

| from                  | to              | trigger                          | rule             |
| --------------------- | --------------- | -------------------------------- | ---------------- |
| `n_root`              | `n_login`       | `routerLink="/login"`            | `ng.router-link` |
| `n_root`              | `n_products`    | `routerLink="/products"`         | `ng.router-link` |
| `n_dashboard`         | `n_products`    | `routerLink="/products"`         | `ng.router-link` |
| `n_dashboard`         | `n_root`        | `router.navigate(['/'])`         | `ng.navigate`    |
| `n_checkout`          | `n_root`        | `router.navigate(['/'])`         | `ng.navigate`    |
| `n_wildcard`          | `n_root`        | `routerLink="/"`                 | `ng.router-link` |

### may (5) — guarded target, or over-approximated bound target

| from                   | to               | trigger                              | guard       | rule                |
| ---------------------- | ---------------- | ------------------------------------ | ----------- | ------------------- |
| `n_login`              | `n_dashboard`    | `router.navigate(['/dashboard'])`    | `AuthGuard` | `ng.navigate`       |
| `n_dashboard`          | `n_dashboard_settings` | `routerLink="/dashboard/settings"` | `AuthGuard` | `ng.router-link`    |
| `n_dashboard_settings` | `n_dashboard`    | `router.navigateByUrl('/dashboard')` | `AuthGuard` | `ng.navigate-by-url`|
| `n_products`           | `n_products_id`  | `[routerLink]="'/products/' + id"`   | —           | `ng.router-link`    |
| `n_products_id`        | `n_checkout`     | `router.navigate(['/checkout'])`     | `AuthGuard` | `ng.navigate`       |

Totals: **8 nodes, 11 edges (6 must, 5 may)**.

## Soundiness

The bound link `[routerLink]="'/products/' + id"` is a non-literal target. The
adapter over-approximates it by its static prefix `/products/` to every declared
route extending that prefix (here `n_products_id`) and records an
`over-approximation` soundiness note. No edge is emitted without a static
witness.
