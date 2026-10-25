# Angular RealWorld Conduit graph coverage audit

Audited on 2026-09-09. Dashboard: http://localhost:4321/. Running app: http://localhost:4200/. Source workspace: `/Users/kanetran29/personal/angular-realworld-example-app`.

**Verdict: all ten route patterns are present, but the application's behavior is not fully covered.** The dashboard's 100% accounted-for and 100% verified/reached figures measure disposition of already-extracted edges. Missing edges are outside those denominators.

The audit read the live dashboard, its graph/coverage/freshness/soundiness/proposals API responses, the workspace observation log, Angular routes, routed templates, shared components, and relevant action handlers. Public navigation was exercised in a separate browser tab. Authenticated mutations and error responses were assessed from source, not executed. No application source, graph, proposals, parks, or observations were changed.

| Snapshot metric | Value |
| --- | --- |
| Source freshness reported by API | Fresh; mapped at 2026-09-09T10:16:13.782Z |
| Base graph hash reported by coverage | `fb86aff09e5a7ea6` |
| Screens / route patterns | 10 |
| Controls | 62 |
| Edges | 28 |
| Recorded runtime witnesses | 7/28 = 25% |
| Static proofs without a runtime witness | 8/28 |
| Verified including static proofs | 15/28 = 53.6% |
| Parked as undrivable | 13/28 = 46.4% |
| Accounted for | 28/28 = 100% |
| Open worklist / proposals | 0 / 0 |
| Screens with screenshot references | 10/10 |
| Extraction warnings | 11 |

The complete route inventory is `/`, `/tag/:tag`, `/login`, `/register`, `/settings`, `/profile/:username`, `/profile/:username/favorites`, `/editor`, `/editor/:slug`, and `/article/:slug`. This matches the route patterns in [app.routes.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/app.routes.ts:14) and [profile.routes.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/profile/profile.routes.ts:4). It does not establish completeness of nested content or of states distinguished by query parameters, authentication, ownership, data loading, and errors.

| Area | Representation and concrete gaps |
| --- | --- |
| Shared navigation | Header controls are absent: Home, Sign in/up, New Article, Settings, and current-user profile. The source renders the header outside the router outlet, so the navigation applies across screens. [header.component.html](/Users/kanetran29/personal/angular-realworld-example-app/src/app/core/layout/header.component.html:10) |
| Feed → article | No edge in the entire graph lands on `n_article_slug`. Article previews visibly link to articles; their controls are absent on Home, tag feeds, and profile lists. [article-preview.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/components/article-preview.component.ts:18) |
| Author and commenter profiles | Author/avatar links in article metadata and comments are absent. [article-meta.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/components/article-meta.component.ts:11), [article-comment.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/components/article-comment.component.ts:23) |
| Feed selection and pagination | Your Feed and Global Feed both resolve to `/` in the graph; `?feed=following` is not represented. Article-list pager nodes have no outgoing edges, so page changes and resulting data changes are missing. [home.component.html](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/home/home.component.html:20), [home.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/home/home.component.ts:73) |
| Authentication | Form/input/button nodes exist, and coarse screen→Home edges exist, but the form controls have no submission edges. Invalid input, server errors, disabled/submitting state, and success as the result of submission are not covered. The login graph also includes the registration-only Username field and Have an account link. [auth.component.html](/Users/kanetran29/personal/angular-realworld-example-app/src/app/core/auth/auth.component.html:7), [auth.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/core/auth/auth.component.ts:66) |
| Settings | The screen and its eight controls have zero outgoing edges. Update Settings → user profile and Logout → Home are missing. The save destination is flagged as an unresolved `/profile/` target. [settings.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/settings/settings.component.ts:56), [user.service.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/core/auth/services/user.service.ts:84) |
| Publishing and editing | Publish Article controls have zero outgoing edges in both editor modes. Successful create/update → `/article/:slug` is missing and flagged as unresolved `/article/`. Tag add/remove and submission-error states are also missing. [editor.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/editor/editor.component.ts:73), [editor.component.html](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/editor/editor.component.html:46) |
| Follow/unfollow | Named wrapper controls exist on profile/article screens but have no outgoing edges. Logged-out redirect to Login and authenticated follow/unfollow state changes are absent. [follow-button.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/profile/components/follow-button.component.ts:55) |
| Favorite/unfavorite | Named wrappers exist on article details but have no outgoing edges; feed favorites are not extracted. Logged-out redirect to Register and authenticated favorite/unfavorite state changes are absent. [favorite-button.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/components/favorite-button.component.ts:54) |
| Comments | Post Comment, its form, and a delete wrapper exist without behavior edges. Add/delete success, list updates, validation/errors, and commenter profile links are missing. [article.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/article/article.component.ts:122) |
| Profile favorites | `/profile/:username/favorites` has zero controls and zero outgoing edges, although the running page has the profile shell, Follow, My Posts, Favorited Posts, article cards, author links, favorites, and pagination. The parent profile's two tabs are each over-approximated to both profile routes. [profile.component.html](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/profile/pages/profile/profile.component.html:33), [profile-favorites.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/profile/components/profile-favorites.component.ts:10) |
| Article management and conditional states | Edit links and Delete Article → Home have edges, but edit is parked, delete is static-only, and author-only visibility, load failures, submission failures, and state changes are not explicitly represented. [article.component.ts](/Users/kanetran29/personal/angular-realworld-example-app/src/app/features/article/pages/article/article.component.ts:73) |

Of the 62 controls, 43 have no outgoing edges. This is a diagnostic count, not a recall percentage: input fields do not necessarily need individual navigation edges. However, the zero-edge controls include primary actions such as Publish Article, Update Settings, Logout, Follow, Favorite, and Post Comment. Every one of the 28 current edges has a navigation effect; no API, error, or state-change effect is represented.

The following browser interactions were confirmed during this audit, without recording them back into the graph:

| Interaction | Observed outcome | Current graph |
| --- | --- | --- |
| Home → first article preview | `/article/how-to-learn-javascript-efficiently` | Missing |
| Article → author link | `/profile/johndoe` | Missing |
| Profile → Favorited Posts | `/profile/johndoe/favorites`; parent controls and article cards remain visible | Route/forward candidates present; destination controls and return actions missing |
| Follow johndoe while logged out | `/login` | Missing |
| Favorite a feed article while logged out | `/register` | Missing |
| Header Home link | `/` | Shared header control/edge missing |

**Recorded runtime evidence needs qualification.** All seven persisted observations have `url-assert` evidence. The recorded login→Home, register→Home, and editor→Home transitions currently generate plans containing only `goto('/')` followed by a URL assertion. They do not fill or submit the relevant forms. Therefore those three witnesses do not establish successful login, registration, or publication. The two tag observations store the route pattern `/tag/:tag` in their evidence instead of a concrete selected tag; they should be rechecked with concrete route values and content assertions. The two auth-switch links have recorded witnesses, but the audit did not independently reproduce the historical driver run.

The extraction warnings already acknowledge missed publish/settings targets and dynamic pagination. They are not converted into outstanding graph edges or proposals here. Consequently an empty Next to verify panel can coexist with these missing behaviors.

Suggested completion order:

1. Extract shared headers, nested child components, and parent router shells, preserving the screen contexts where each control is visible.
2. Resolve dynamic router-command arrays and query parameters, and connect form submissions, component outputs, and service-driven actions to navigation/API/state/error outcomes.
3. Build an explicit Conduit behavior checklist covering logged-out, logged-in, author/non-author, success/error, and list/empty/loading states. Use that checklist to measure extraction recall separately from edge verification.
4. Verify against concrete article/profile/tag URLs with suitable authenticated fixtures, exercising controls and checking requests/content changes. Reassess parked edges and the three goto-only witnesses. Authenticated writes were not performed as part of this inspection.

No defensible overall behavior-coverage percentage can be derived from the current 28-edge denominator: it excludes the demonstrated missing transitions.
