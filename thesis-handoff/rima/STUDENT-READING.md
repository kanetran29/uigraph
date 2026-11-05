# Verdicts for the author to read

Generated 5 Nov 2026. Every verdict below was made by the AI assistant (one model reading, a stronger
model re-reading some). Read each pair in the source and write your own verdict. When tier 1 is done,
the thesis can state how many of a seeded sample you confirmed.

**Rules (as the readers applied them).** A pair (s, t) is *real* if a user on screen s can trigger a
navigation that lands on t: a link or a handler in a component shown on s (the routed components, the
shell above the outlet, what their templates include, dialogs they open), possibly after an await or
behind a guard, the trigger being shown while the user stays on s. *Spurious* if no such trigger
exists. *Unclear* if the source does not decide it. A route parameter may take any value; a redirect
counts. Sites are relative to the application directory given in each heading.

Application directories:
- realworld: `/Users/kanetran29/personal/uigraph-work/corpus/realworld`
- alfresco: `/Users/kanetran29/personal/uigraph-work/corpus/alfresco/projects/aca-content`
- ghostfolio: `/Users/kanetran29/personal/uigraph-work/corpus/ghostfolio/apps/client`
- k8sdash: `/Users/kanetran29/personal/uigraph-work/corpus/k8sdash/modules/web`
- bitwarden: `/Users/kanetran29/personal/uigraph-work/corpus/bitwarden/apps/web`
- mifos: `/Users/kanetran29/personal/uigraph-work/corpus/mifos`
- posts-users-ui-ng: `/Users/kanetran29/personal/uigraph-work/rima/src/anonbnr__posts-users-ui-ng`
- heroes-angular: `/Users/kanetran29/personal/uigraph-work/rima/src/johnpapa__heroes-angular`
- airbus-inventory: `/Users/kanetran29/personal/uigraph-work/rima/src/Akash-goyal-github__Inventory-Management-System/AirbusInventory`
- spring-petclinic-angular: `/Users/kanetran29/personal/uigraph-work/rima/src/parsaalian__autoe2e/benchmark/pet-clinic/spring-petclinic-angular`
- ever-traduora: `/Users/kanetran29/personal/uigraph-work/rima/src/parsaalian__autoe2e/benchmark/ever-traduora/webapp`
- angular-jumpstart: `/Users/kanetran29/personal/uigraph-work/rima/src/DanWahlin__Angular-JumpStart`
- event-booking-mean: `/Users/kanetran29/personal/uigraph-work/rima/src/bekitos101__Event-Booking-App-MEAN-STACK/EventNest/Frontend/app`

## Tier 1 — behind the headline (five corpus apps other than mifos), 3 per stratum, seed 20261107

### realworld — both tools

1. [ ] **realworld** `/` → `/profile/:username`
   - AI verdict: **real**; site: `src/app/features/article/components/article-meta.component.ts:11`
   - Reason given: The article previews on home render article-meta, which links to /profile/<author>. The header also links to /profile/<currentUser> for signed-in users.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
2. [ ] **realworld** `/profile/:username/favorites` → `/editor`
   - AI verdict: **real**; site: `src/app/core/layout/header.component.html:33`
   - Reason given: The header New Article link for signed-in users is shown on all routes, including the favorites child route.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
3. [ ] **realworld** `/settings` → `/editor`
   - AI verdict: **real**; site: `src/app/core/layout/header.component.html:33`
   - Reason given: /settings requires authentication, and the header New Article link is shown to authenticated users.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### realworld — only Rima et al.'s tool

4. [ ] **realworld** `/login` → `/article/:slug`
   - AI verdict: **spurious**; site: `—`
   - Reason given: Confirmed. /login renders AuthComponent behind a guard that admits only signed-out users (app.routes.ts canActivate !isAuth). Its template links only to /register (auth.component.html:12), and submitForm navigates to '/' on success (auth.component.ts:76). On /login the header shows only '/', '/login' and '/register', and the footer only '/'. The cited article-preview.component.ts (link at line 18 to ['/article', slug
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
5. [ ] **realworld** `/register` → `/article/:slug`
   - AI verdict: **spurious**; site: `—`
   - Reason given: Confirmed. /register uses the same AuthComponent, also behind a signed-out-only guard. Its template links only to /login (auth.component.html:8), and a successful sign-up navigates to '/' (auth.component.ts:76). The header (signed-out branch) and the footer have no article links, and article-preview/article-list are not rendered on this route.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
6. [ ] **realworld** `/settings` → `/article/:slug`
   - AI verdict: **spurious**; site: `—`
   - Reason given: Confirmed. SettingsComponent imports only ListErrorsComponent and ReactiveFormsModule and has no routerLink. Its navigations are submit to ['/profile/', username] (settings.component.ts:72) and logout via UserService.logout to '/' (user.service.ts:86). The header and footer have no article links. article-preview is not shown on /settings.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### alfresco — both tools

7. [ ] **alfresco** `/profile` → `/personal-files`
   - AI verdict: **real**; site: `src/lib/components/view-profile/view-profile.component.html:16`
   - Reason given: The back-arrow button calls navigateToPersonalFiles(), which runs router.navigate(['/personal-files']) (view-profile.component.ts:141). The sidenav personal-files link also reaches it.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
8. [ ] **alfresco** `/saved-searches` → `/search`
   - AI verdict: **real**; site: `src/lib/components/search/search-save/list/ui-list/saved-searches-list.ui-component.ts:163`
   - Reason given: The row action and context-menu action 'Execute search' call executeSearch(), which runs router.navigate(['/search'], {queryParams:{q}}). The sidenav saved-search links also go to search?q=.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### alfresco — only Rima et al.'s tool

9. [ ] **alfresco** `/personal-files/details/:nodeId` → `/profile`
   - AI verdict: **real**; site: `src/lib/components/common/user-info/user-info.component.html:1`
   - Reason given: The route is under the content shell, so the header user menu is shown. UserInfoComponent has routerLink '/profile', and the guard admits logged-in users.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
10. [ ] **alfresco** `/rules` → `/profile`
   - AI verdict: **spurious**; site: `projects/aca-content/folder-rules/src/folder-rules.module.ts:35`
   - Reason given: The literal /rules route is the top-level 'rules' route from FOLDER_RULES_ROUTES (folder-rules.module.ts:35). provideFolderRulesExtension() adds it to the root config with provideRouter. Its ROUTES providers (through ContentServiceExtensionModule and provideApplicationExtensions) are registered before provideShellRoutes(CONTENT_LAYOUT_ROUTES) in app/src/app/app.config.ts, so /rules matches it first. It renders Manage
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
11. [ ] **alfresco** `/search` → `/profile`
   - AI verdict: **real**; site: `src/lib/components/common/user-info/user-info.component.html:1`
   - Reason given: The search route (aca-content.routes.ts:364) is a child of CONTENT_LAYOUT_ROUTES, which provideShellRoutes wraps in ShellLayoutComponent. The shell renders 'app.layout.sidenav', which maps to SidenavComponent. That includes app-sidenav-header, whose aca-toolbar shows the 'features.header' actions. Among them is 'app.header.more' (UserMenuComponent), a mat-menu whose 'app.header.user' item renders UserInfoComponent, w
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### alfresco — only this extractor

12. [ ] **alfresco** `/libraries` → `/search`
   - AI verdict: **real**; site: `assets/app.extensions.json:381`
   - Reason given: /libraries renders LibrariesComponent, whose template holds <aca-libraries-base>. That component extends PageComponent, and PageComponent.ngOnInit sets actions from getAllowedToolbarActions(), which libraries-base.component.html passes to <aca-toolbar [items]="actions"/>. The toolbar item app.toolbar.search has click 'SEARCH'. Its visible rule is !app.navigation.isSearchResults, meaning the URL does not start with '/
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
13. [ ] **alfresco** `/search` → `/personal-files`
   - AI verdict: **real**; site: `src/lib/components/search/search-navigation.service.ts:57`
   - Reason given: SearchResultsComponent renders <aca-search-input/>, whose close button calls exitSearch() then navigateBack(). With no saved previousRoute (for example /search opened by direct URL or a saved-search link, since only navigateToSearch() sets it) it calls router.navigate(['/personal-files']).
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
14. [ ] **alfresco** `/search-libraries` → `/personal-files`
   - AI verdict: **real**; site: `src/lib/components/search/search-navigation.service.ts:57`
   - Reason given: SearchLibrariesResultsComponent renders <aca-search-input/>. Its close button runs exitSearch() then navigateBack(), which falls back to router.navigate(['/personal-files']) when previousRoute is empty (direct load of /search-libraries).
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### ghostfolio — both tools

15. [ ] **ghostfolio** `/accounts` → `/accounts/:accountId`
   - AI verdict: **real**; site: `../../libs/ui/src/lib/accounts-table/accounts-table.component.ts:191`
   - Reason given: gf-accounts-table on /accounts calls router.navigate(accounts.detail.routerLink(accountId)) in onOpenAccountDetailDialog. hasPermissionToOpenDetails defaults to true. The accounts-page template does not override it.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
16. [ ] **ghostfolio** `/accounts/create` → `/accounts/:accountId`
   - AI verdict: **real**; site: `../../libs/ui/src/lib/assistant/assistant.component.ts:620`
   - Reason given: Verdict confirmed, but through a different trigger. On /accounts/create the dialog host opens a modal MatDialog (account-dialog-host.component.ts:297). Its backdrop covers the accounts table, and clicking the backdrop closes the dialog and navigates back to /accounts. So the row click at accounts-table.component.ts:191 is not operable while the user stays on s. The header (shell) opens the assistant with the '/' hotk
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
17. [ ] **ghostfolio** `/accounts/transfer-cash-balance` → `/accounts/:accountId`
   - AI verdict: **real**; site: `../../libs/ui/src/lib/accounts-table/accounts-table.component.ts:191`
   - Reason given: The transfer route is also a child of the accounts page. The same accounts table row click navigates to /accounts/:accountId.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### ghostfolio — only Rima et al.'s tool

18. [ ] **ghostfolio** `/account/access` → `/internalRoutes.account.path/access.path/:accessId`
   - AI verdict: **spurious**; site: `src/app/components/user-account-access/user-account-access.html:78`
   - Reason given: The target resolves to /account/access/:accessId. In user-account-page.routes.ts, ':accessId' has only an 'update' child and no '' child or component, so that URL is not a routed screen. The fab at lines 78-82 links to access/create, and access-table links to access/:id/update. Nothing links to /account/access/:id.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
19. [ ] **ghostfolio** `/account/access/:accessId/update` → `/internalRoutes.account.path/access.path/:accessId`
   - AI verdict: **spurious**; site: `src/app/components/user-account-access/access-dialog-host/access-dialog-host.component.ts:147`
   - Reason given: /account/access/:accessId is not routable, because ':accessId' has only the 'update' child. The dialog host's navigateBack goes to ['/account','access']. The access-table links go to .../update and the fab goes to access/create. No trigger names /account/access/:id.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
20. [ ] **ghostfolio** `/portfolio/activities/create` → `/internalRoutes.portfolio.path/internalRoutes.portfolio.subRoutes.activities.path/:activityId`
   - AI verdict: **spurious**; site: `src/app/pages/portfolio/activities/activities-page.html:44`
   - Reason given: The resolved target /portfolio/activities/:activityId matches no route, because ':activityId' has only clone and update children. The fab links to .../create, the rows link to :id/update and :id/clone, and closing the dialog returns to /portfolio/activities.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### ghostfolio — only this extractor, shell-only

21. [ ] **ghostfolio** `/accounts/:accountId` → `/admin`
   - AI verdict: **real**; site: `src/app/components/header/header.component.html:74`
   - Reason given: The shell header, shown while the account dialog is open, has an 'Admin Control' link with routerLink ['/admin'] (line 74, plus a menu copy at 279-282). It is shown when hasPermissionToAccessAdminControl is true, which holds for admin users.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
22. [ ] **ghostfolio** `/demo` → `/portfolio/activities`
   - AI verdict: **spurious**; site: `src/app/pages/demo/demo-page.component.ts:38`
   - Reason given: The demo page has an empty template. Its ngOnInit always calls router.navigate(['/']), which goes through the '**' redirect to home. The user never stays on /demo, so header triggers such as the assistant's Activities quick link exist only during a transient moment of navigating away. The holding detail dialog's navigateToActivities is not open on /demo.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
23. [ ] **ghostfolio** `/home/holdings` → `/accounts/transfer-cash-balance`
   - AI verdict: **real**; site: `../../libs/ui/src/lib/assistant/assistant.component.ts:705`
   - Reason given: The holdings page's own accounts-table does have the Transfer Cash Balance button hidden, as the reader said. But /home/holdings requires a signed-in user, and the signed-in header always shows the assistant. Its quick links include accounts.subRoutes.transferCashBalance (array routerLink ['/accounts','transfer-cash-balance'], not excluded), so searching 'Transfer Cash Balance' gives a link to it.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### ghostfolio — only this extractor, other

24. [ ] **ghostfolio** `/accounts` → `/accounts/create`
   - AI verdict: **real**; site: `src/app/pages/accounts/accounts-page.html:25`
   - Reason given: The accounts page shows a gf-fab with routerLink internalRoutes.accounts.subRoutes.create.routerLink (/accounts/create). It sits inside @if (hasPermissionToCreateAccount && !isRestrictedView), which is user-dependent but normally true. accounts-page.component.ts:140 also navigates there when the user has no accounts.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
25. [ ] **ghostfolio** `/blog/2026/04/ghostfolio-3` → `/zen`
   - AI verdict: **real**; site: `src/app/core/auth.guard.ts:87`
   - Reason given: The signed-in header logo and Overview links go to '/'. That matches '**' with redirectTo 'home', and AuthGuard on /home then router.navigate to /zen when viewMode is ZEN. The route is reached through a redirect and a guard, so I counted it real.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
26. [ ] **ghostfolio** `/features` → `/zen`
   - AI verdict: **real**; site: `src/app/core/auth.guard.ts:87`
   - Reason given: Features shows the header, with its logo and Overview links to '/', and the footer logo. '/' redirects to home, and AuthGuard sends a ZEN-viewMode user from home to /zen.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### k8sdash — both tools

27. [ ] **k8sdash** `/` → `/create`
   - AI verdict: **spurious**; site: `src/index.routing.ts:21`
   - Reason given: The URL '/' only matches {path:'', redirectTo:'/workloads', pathMatch:'full'} (index.routing.ts:21; the same redirect is at chrome/routing.ts:21). No routed component is ever shown on '/'. Only RootComponent's bare <router-outlet> exists there. The chrome '+' button (chrome/component.ts:82, template.html:50) appears only after the redirect lands on /workloads, which is a transient moment during navigation away from '
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
28. [ ] **k8sdash** `/` → `/overview`
   - AI verdict: **spurious**; site: `src/index.routing.ts:21`
   - Reason given: '/' is redirect-only (to /workloads) and shows no component. The namespace selector (namespace/component.ts:226) is in the chrome shell, which is not rendered on '/'. The create-form navigate(['overview']) calls are on /create screens, not on '/'.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
29. [ ] **k8sdash** `/` → `/search`
   - AI verdict: **spurious**; site: `src/index.routing.ts:21`
   - Reason given: '/' is redirect-only (to /workloads). The kd-search form (chrome/search/component.ts:45) sits in the chrome shell, which is never shown while the URL is '/'.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### k8sdash — only Rima et al.'s tool

30. [ ] **k8sdash** `/login` → `/overview`
   - AI verdict: **real**; site: `src/login/component.ts:53`
   - Reason given: After a successful login, login() calls historyService.goToPreviousState('workloads'). That does navigateByUrl(previousStateUrl_), the URL AuthGuard saved when it bounced the user to login. A user who first opened /overview while signed out lands on /overview. The target is not hard-coded, and the code does not restrict it to /overview.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
31. [ ] **k8sdash** `/login` → `/search`
   - AI verdict: **real**; site: `src/login/component.ts:53`
   - Reason given: Clicking Sign in on /login calls login() (component.ts:53), which runs historyService.goToPreviousState('workloads') after the HTTP login succeeds. That calls navigateByUrl(previousStateUrl_) (history.ts:52). previousStateUrl_ comes from the pairwise NavigationEnd tracker (history.ts:36). Example: a user on /search?q=x signs out from the chrome user panel (authService.logout navigates to /login), or a 401 makes error
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### k8sdash — only this extractor

32. [ ] **k8sdash** `/configmap` → `/search`
   - AI verdict: **real**; site: `src/chrome/search/component.ts:45`
   - Reason given: The chrome shell template includes <kd-search> in the main toolbar. Its submit() calls router.navigate(['search']) when the form is valid, which goes to /search. It is shown on /configmap because that route sits under ChromeComponent.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
33. [ ] **k8sdash** `/networkpolicy` → `/overview`
   - AI verdict: **spurious**; site: `src/common/components/namespace/component.ts:224`
   - Reason given: The /networkpolicy list route (path '' in src/resource/cluster/networkpolicy/routing.ts) has no :resourceNamespace param, so resourceNamespaceParam is undefined. The guard at line 224 therefore skips navigate(['overview']) (line 226), and the namespace-change dialog that leads to goToPreviousState('overview') never opens, because shouldShowNamespaceChangeDialog needs that param. Only the detail route ':resourceNamesp
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
34. [ ] **k8sdash** `/networkpolicy` → `/search`
   - AI verdict: **real**; site: `src/chrome/search/component.ts:45`
   - Reason given: The shell's <kd-search> bar submit() calls router.navigate(['search']). The bar is shown on every ChromeComponent child route, including /networkpolicy.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### bitwarden — both tools

35. [ ] **bitwarden** `/request-sm-access` → `/sm-landing`
   - AI verdict: **real**; site: `src/app/secrets-manager/secrets-manager-landing/request-sm-access.component.html:32`
   - Reason given: The form's Cancel button has [routerLink]="'/sm-landing'".
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### bitwarden — only Rima et al.'s tool

36. [ ] **bitwarden** `/AuthRoute.TwoFactor` → `/settings/security/session-timeout`
   - AI verdict: **real**; site: `src/app/auth/guards/deep-link/deep-link.guard.ts:39`
   - Reason given: Real, but only through the deep-link restore. After a successful 2FA submit, handleAuthResult calls router.navigate([defaultSuccessRoute]), which is normally 'vault' (../../libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts:506). The UserLayout route's deepLinkGuard (oss-routing.module.ts:682) then calls navigateByUrl with the URL the user asked for while signed out (deep-link.guard.ts:39). Opening /s
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
37. [ ] **bitwarden** `/secrets-manager-trial-initiation` → `/vault`
   - AI verdict: **real**; site: `../../libs/components/src/landing-layout/landing-header.component.html:4`
   - Reason given: The reader's 'the anon layout has no vault link' is wrong. The anon layout's header always shows the logo link [routerLink]=['/'] (hideLogo defaults to false and the wrapper never sets it). '/' is guarded by redirectGuard (oss-routing.module.ts:130), which sends unlocked users to /vault (libs/angular/.../redirect.guard.ts:21). With the trial stepper on (product=SM plus a productTier query param), handlePasswordSubmit
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
38. [ ] **bitwarden** `/send/:sendId/:key` → `/vault`
   - AI verdict: **real**; site: `../../libs/components/src/landing-layout/landing-header.component.html:4`
   - Reason given: The send page has no guard, so a signed-in, unlocked user can view it. Its anon-layout header shows the logo link [routerLink]=['/'], and redirectGuard on '' (oss-routing.module.ts:130) sends an unlocked user to /vault (redirect.guard.ts:21). So the logo lands on /vault for an existing user: one with no premium-interest flag who is older than 30 days or has dismissed setup-extension. This is a guard redirect rather t
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

### bitwarden — only this extractor

39. [ ] **bitwarden** `/device-verification` → `/remove-password`
   - AI verdict: **spurious**; site: `../../libs/common/src/key-management/key-connector/services/key-connector.service.ts:115`
   - Reason given: The reader's reason is wrong, but the verdict holds. A sender does exist: DefaultSyncService sends 'convertAccountToKeyConnector' (libs/common/src/platform/sync/default-sync.service.ts:290), and submit on this screen runs loginSuccessHandlerService.run, which does a fullSync. After that, submit navigates to /vault, where authGuard can redirect to /remove-password (auth.guard.ts:108). Both paths require convertAccount
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
40. [ ] **bitwarden** `/recover-delete` → `/organizations/:organizationId/billing/subscription`
   - AI verdict: **spurious**; site: `src/app/app.component.ts:143`
   - Reason given: The AppComponent 'upgradeOrganization' handler is the only hinted trigger. That message is sent only from vault screens (vault-cipher-actions.service.ts:123 and individual vault.component.ts:934). recover-delete is an anon screen that offers only routerLink /login, a submit that navigates to '/' (which goes on to /login for a signed-out user), and the environment selector. Nothing shown on it can send that message or
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
41. [ ] **bitwarden** `/reports/breach-report` → `/organizations/:organizationId/billing/subscription`
   - AI verdict: **real**; site: `src/app/billing/individual/upgrade/upgrade-payment/upgrade-payment.component.html:20`
   - Reason given: The reports routes are under UserLayout. Its app-side-nav (web-side-nav) shows app-upgrade-callout when shouldShowPremiumUpgradeButton$ is true (non-premium user). The callout's upgrade() opens UnifiedUpgradeDialog, which contains app-upgrade-payment. When the Families plan is chosen and the user owns a free org, that step shows a routerLink to `/organizations/${org.id}/billing/subscription` (upgrade-payment.service.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

## Tier 2 — the first comparison: every miss and every pair read as spurious

42. [ ] **airbus-inventory** `/login` → `/add`
   - AI verdict: **spurious**; site: `src/app/main-nav/main-nav.component.html:26`
   - Reason given: /login renders only LoginPageComponent. Neither its template nor the app shell includes <app-main-nav>: app.component.html holds only <router-outlet>, and index.html holds only <app-root>. So the routerLink="/add" at line 26 is never rendered on /login. LoginPageComponent's only navigation is routeToDashboard (login-page.component.ts:63).
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
43. [ ] **airbus-inventory** `/login` → `/getAllProducts`
   - AI verdict: **spurious**; site: `src/app/services/router.service.ts:20`
   - Reason given: main-nav, with routerLink /getAllProducts at line 19, is not rendered on /login. routeToAllProduct (router.service.ts:20) is called only from SuccessfulDialogComponent and UnSuccessfulDialogComponent. Those dialogs are opened only from GetAllProductsComponent and UpdateProductComponent, never from the login page. The login page navigates only to /dashboard.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
44. [ ] **airbus-inventory** `/login` → `/productByCategory`
   - AI verdict: **spurious**; site: `src/app/main-nav/main-nav.component.html:11`
   - Reason given: The routerLink="/productByCategory" is only in MainNavComponent. MainNavComponent is not included by LoginPageComponent or by the app shell (app.component.html is just <router-outlet>), so no trigger for /productByCategory exists on /login.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
45. [ ] **spring-petclinic-angular** `/pets` → `/**` (a reference pair the graph misses; class e)
   - AI verdict: **e**; site: `src/app/app.component.html:35`
   - Reason given: Both cited triggers, app.component.html:35 (Owners) and :47 (Veterinarians), are Bootstrap dropdown toggles: <a data-toggle="dropdown"> with only a (click)="log(...)" handler, and no routerLink or href. AppComponent's log() only logs. On /pets (PetListComponent plus the shell), every shell link points to a defined route (welcome, /owners, /owners/add, /vets, /vets/add, /pettypes, /specialties), and the navbar-brand h
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
46. [ ] **spring-petclinic-angular** `/pettypes` → `/pettypes/add` (a reference pair the graph misses; class e)
   - AI verdict: **e**; site: `src/app/pettypes/pettype-add/pettype-add.component.ts:33`
   - Reason given: The cited triggers (form ngSubmit at pettype-add.component.html:22, submit button at :34) call onSubmit. After the HTTP add, onSubmit only emits newPetType (ts:33); PettypeAddComponent has no Router. On /pettypes the component is embedded inline as <app-pettype-add> behind *ngIf="isInsert" (pettype-list.component.html:43-44). The emit is handled by onNewPettype, which only toggles isInsert. Nothing in the app navigat
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
47. [ ] **spring-petclinic-angular** `/visits/add` → `/pets/1/visits/add` (a reference pair the graph misses; class e)
   - AI verdict: **e**; site: `src/app/visits/visit-add/visit-add.component.ts:102`
   - Reason given: The cited form submit (visit-add.component.html:43) calls onSubmit. On HTTP success that calls gotoOwnerDetail(), which runs router.navigate(['/owners', currentOwner.id]) and lands on /owners/:id. The only other component on this screen is the embedded app-visit-list, which navigates only to /visits/:id/edit. The only navigation to /pets/:id/visits/add in the app is pet-list.component.ts:67, and PetListComponent is n
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
48. [ ] **spring-petclinic-angular** `/owners/:id/edit` → `/owners/:id/pets/add`
   - AI verdict: **spurious**; site: `src/app/owners/owner-edit/owner-edit.component.ts:70`
   - Reason given: The witness navigate is router.navigate(['/owners', owner.id]), reached from the Back button and from submit success. That is two segments and matches only owners/:id (OwnerDetailComponent). A non-first command is never split on '/', so no id value can produce /owners/:id/pets/add. The owner-edit template has no routerLink and embeds no component. The pets/add navigate is owner-detail.component.ts:64, and OwnerDetail
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
49. [ ] **spring-petclinic-angular** `/owners/:id/pets/add` → `/owners/:id/edit`
   - AI verdict: **spurious**; site: `src/app/pets/pet-add/pet-add.component.ts:90`
   - Reason given: gotoOwnerDetail(), used by the Back button (pet-add.component.html:87) and after submit success, calls router.navigate(['/owners', currentOwner.id]). That lands on owners/:id (detail), not owners/:id/edit. The pet-add template has no routerLink and embeds no component with a navigate to the edit route. The only /owners/:id/edit navigate is owner-detail.component.ts:60, which is not rendered here.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
50. [ ] **spring-petclinic-angular** `/pets/:id/visits/add` → `/owners/:id/pets/add`
   - AI verdict: **spurious**; site: `src/app/visits/visit-add/visit-add.component.ts:102`
   - Reason given: VisitAddComponent's only navigate is router.navigate(['/owners', currentOwner.id]), from the Back button and after submit. That is owners/:id (detail), not owners/:id/pets/add. The embedded app-visit-list navigates only to /visits/:id/edit. The pets/add navigate lives in owner-detail.component.ts:64, and OwnerDetailComponent is not rendered on this screen.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
51. [ ] **spring-petclinic-angular** `/visits/:id/edit` → `/owners/:id/edit`
   - AI verdict: **spurious**; site: `src/app/visits/visit-edit/visit-edit.component.ts:98`
   - Reason given: gotoOwnerDetail() (Back button, and after the update succeeds) calls router.navigate(['/owners', currentOwner.id]). That lands on owners/:id (detail), not owners/:id/edit. The visit-edit template embeds no other component and has no routerLink. The shell has no link to an owner's edit route.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
52. [ ] **spring-petclinic-angular** `/visits/add` → `/owners/:id/edit`
   - AI verdict: **spurious**; site: `src/app/visits/visit-add/visit-add.component.ts:102`
   - Reason given: gotoOwnerDetail() calls router.navigate(['/owners', currentOwner.id]), which is owners/:id (detail), not owners/:id/edit. The embedded app-visit-list navigates only to /visits/:id/edit. The shell has no owner-edit link, so nothing on /visits/add reaches /owners/:id/edit.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
53. [ ] **ever-traduora** `/projects/:projectId/translations` → `/projects/:projectId/translations/:localeCode` (a reference pair the graph misses; class f)
   - AI verdict: **f**; site: `src/app/projects/components/project-locales/project-locales.component.html:17`
   - Reason given: The reader's premise is false: the graph has an edge for this construct. It is attributed to the correct start screen: n_projects_projectId_translations -> u_n_projects_projectId_translations ('dynamic target from /projects/:projectId/translations', kind unknown, modality unknown), witness project-locales.component.html:17:36. The soundiness file also records it as 'fully dynamic navigation target'. The site was read
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
54. [ ] **ever-traduora** `/projects/:projectId` → `/projects/:projectId/translations/:localeCode` (a reference pair the graph misses; class f)
   - AI verdict: **f**; site: `src/app/projects/components/project-locales/project-locales.component.html:17`
   - Reason given: Same trigger and the same primary cause as the translations pair. The graph holds an edge for project-locales.component.html:17, but only into the unknown node u_n_projects_projectId_translations, because the dynamic relative target [locale.locale.code] is left unresolved. That is not (b). A second factor exists: /projects/:projectId is a redirect-only route (projects.module.ts:48, '' redirectTo 'translations', pathM
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
55. [ ] **ever-traduora** `/forgot-password` → `/projects`
   - AI verdict: **spurious**; site: `src/app/auth/components/forgot-password/forgot-password.component.html:29`
   - Reason given: The app bar is behind *ngIf=isAuthenticated$ (app.component.html:3) and /forgot-password carries NoAuthGuard, so it is not shown there; the page's only link is /login (line 29) and its action only sets a status message.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
56. [ ] **ever-traduora** `/forgot-password` → `/user-settings`
   - AI verdict: **spurious**; site: `src/app/auth/components/forgot-password/forgot-password.component.html:29`
   - Reason given: As for /forgot-password -> /projects: the app bar is not shown under NoAuthGuard, and nothing else on the page reaches /user-settings.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
57. [ ] **ever-traduora** `/projects/:projectId/settings` → `/projects/:projectId/translations/:localeCode`
   - AI verdict: **spurious**; site: `src/app/projects/components/project-settings/project-settings.component.html:46`
   - Reason given: The witness is the Cancel button [routerLink]="['/projects', project.id]". It resolves to exactly /projects/:projectId, which redirects to 'translations' (projects.module.ts:48), never to translations/:localeCode. The graph over-approximated the non-literal prefix '/projects/' to 10 routes, as the soundiness file shows. No other trigger on settings reaches this route. Settings' onSubmit dispatches UpdateProject. onDe
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

## Tier 3 — mifos (small samples decide its figures)

58. [ ] **mifos** `/clients/:clientId/fixed-deposits-accounts/create` → `/groups` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:156`
   - Reason given: The clients routes are wrapped in Route.withShell, so the toolbar is shown on s. Its Institution menu has routerLink='/groups', gated only by the READ_GROUP permission, and /groups routes to GroupsComponent.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
59. [ ] **mifos** `/clients/:clientId/loans-accounts/:loanId/breach-actions` → `/groups/:groupId/loans-accounts/:loanId/dashboard` (only this extractor (moved))
   - AI verdict: **spurious**; site: `src/app/loans/loans-view/loans-view.component.html:332`
   - Reason given: ['./dashboard'] is relative and stays under /clients/:c/loans-accounts/:id. The breach-actions tab navigates only to ../actions/<name>. The tray goes to /{clients|groups}/{id}/loans-accounts/{id}, which redirects to 'general', not 'dashboard'.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
60. [ ] **mifos** `/clients/:clientId/loans-accounts/glim-account/create` → `/reports` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:193`
   - Reason given: The shell toolbar's Reports menu has an 'All' item with [routerLink]=['/reports']. It is shown on s and gated only by READ_REPORT. The other cited sites are on other screens.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
61. [ ] **mifos** `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/transfer-funds/account-transfers/:transferid` → `/navigation` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/sidenav/sidenav.component.html:97`
   - Reason given: The shell sidenav has a list item with [routerLink]=['/navigation'], shown on s and gated only by READ_CLIENT. The route 'navigation' exists in app-routing.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
62. [ ] **mifos** `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/transfer-funds/list-standing-instructions` → `/centers` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:159`
   - Reason given: The shell toolbar's Institution menu has a Centers item with routerLink='/centers', shown on s and gated only by READ_CENTER.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
63. [ ] **mifos** `/clients/:clientId/standing-instructions/make-account-transfer` → `/groups/:groupId/savings-accounts/:savingAccountId/transfer-funds/:standingInstructionsId/view` (only this extractor (moved))
   - AI verdict: **spurious**; site: `src/app/account-transfers/make-account-transfers/make-account-transfers.component.html:225`
   - Reason given: The MakeAccountTransfers links are relative ('../..', '../../transactions') and stay under the client. Submit only advances the stepper. The checker-inbox row link is not shown on s. The tray goes only to the group savings account root.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
64. [ ] **mifos** `/groups/:groupId/loans-accounts/:loanId/dashboard` → `/clients/:clientId/savings-accounts/:savingAccountId/documents` (only this extractor (moved))
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: ClientsViewComponent (the hinted clients-view.html:468) is not shown under /groups/.../loans-accounts. The dashboard tab has no navigation. The tray lands on the savings account root, which redirects to general, with no /documents.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
65. [ ] **mifos** `/loans/:loanId/breach-actions` → `/centers/:centerId/savings-accounts/:savingAccountId/documents` (only this extractor (moved))
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The tray builds only /{clients|groups}/<id>/savings-accounts/<accountId>, with no centers prefix and no /documents. ClientsViewComponent is not shown under /loans/:loanId. The breach-actions tab goes only to ../actions/<name>.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
66. [ ] **mifos** `/loans/:loanId/loan-collateral` → `/reports` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:193`
   - Reason given: LOANS_LIST_ROUTES wraps the /loans routes in Route.withShell, so the toolbar is shown. Its Reports menu item 'All' has [routerLink]=['/reports'], gated only by READ_REPORT, and /reports is a routed lazy module. The web-app keyboard shortcut with route 'reports' is a second trigger.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
67. [ ] **mifos** `/loans/:loanId/payment-rates` → `/groups/:groupId/loans-accounts/:loanId/originators` (only this extractor (moved))
   - AI verdict: **spurious**; site: `src/app/loans/loans-view/loans-view.component.html:509`
   - Reason given: ['./originators'] is relative and resolves to /loans/:loanId/originators. The tray goes only to /groups/:id/loans-accounts/:accountId, which redirects to general, never to originators.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
68. [ ] **mifos** `/loans/:loanId/transactions/export` → `/accounting` (both tools)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:55`
   - Reason given: The shell toolbar is shown on this screen and has an Accounting link with routerLink ['/accounting']. It sits behind a permission directive only.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
69. [ ] **mifos** `/organization/exchange-rates/:id` → `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/transfer-funds/:standingInstructionsId/view` (both tools)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:228`
   - Reason given: The tray navigates only to /{clients|groups}/:id/recurring-deposits-accounts/:accountId, which redirects to general, with no transfer-funds sub-route. The checker-inbox link is in a tasks component that is not shown on this screen.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
70. [ ] **mifos** `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/standing-instructions-tab` → `/appusers` (only Rima et al.'s tool)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:214`
   - Reason given: The shell toolbar's Admin menu has a Users item with [routerLink]=['/appusers'], shown on s and gated only by READ_USER. The route 'appusers' exists in app-routing.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
71. [ ] **mifos** `/groups/:groupId/loans-accounts/:loanId/loan-documents` → `/appusers` (only Rima et al.'s tool)
   - AI verdict: **real**; site: `src/app/core/shell/toolbar/toolbar.component.html:214`
   - Reason given: The group loan view is mounted under the shell, which renders mifosx-toolbar. Its Admin menu has [routerLink]=['/appusers'] guarded only by the READ_USER permission directive. That is not a visibility condition tied to s, and /appusers is a routed lazy module (app-routing.module.ts). The view-user and edit-user links are not on s.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
72. [ ] **mifos** `/groups/:groupId/loans-accounts/:loanId/original-schedule` → `/:loanId/datatables` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/loans/loans-view/loans-view.component.html:678`
   - Reason given: The only datatable link is ['./datatables', registeredTableName], which lands on .../loans-accounts/:id/datatables/:datatableName. The loans 'datatables' node has only a ':datatableName' child, so a bare .../datatables URL matches no component. '/:loanId/datatables' is not a declared mount (the loans module is mounted under clients/, groups/ and loans/). No trigger produces it.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
73. [ ] **mifos** `/loans/glim-account/:glimId` → `/loans/:loanId/charges/:id` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/loans/glim-account/glim-account.component.html:86`
   - Reason given: s resolves to GlimAccountComponent (':loanId' fails on the extra segment, so the router backtracks to 'glim-account/:glimId'). Its links go only to /loans-accounts/<child>/actions/... and /loans-accounts/<child>/general. The hinted client general-tab is not shown. Nothing reaches a loan charge view.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
74. [ ] **mifos** `/accounting/provisioning-entries/journal-entries/view/:id` → `/clients/:clientId/fixed-deposits-accounts/:fixedDepositAccountId/charges` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:218`
   - Reason given: ViewProvisioningJournalEntriesComponent has no links or router calls. In the shell, the notifications tray goes only to /{clients|groups}/{id}/fixed-deposits-accounts/{accountId}, and the FD routing redirects '' to 'general', not 'charges'. Nothing else in the shell names the FD charges tab.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
75. [ ] **mifos** `/clients/:clientId/standing-instructions/create-standing-instructions` → `/groups/:groupId/savings-accounts/:savingAccountId/charges/:id` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/account-transfers/create-standing-instructions/create-standing-instructions.component.ts:377`
   - Reason given: CreateStandingInstructions only navigates relatively: ['../'] in the template and navigate(['../../']) at ts:377. The tray reaches only the group savings account root, which redirects to general, never charges/:id.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
76. [ ] **mifos** `/groups/:groupId/loans-accounts/:loanId/balances` → `/groups/:groupId/savings-accounts/:savingAccountId/transactions/:id/edit` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The balances tab has no navigation, and the loans-view tabs are relative to the loan. The tray goes only to /groups/<id>/savings-accounts/<accountId>, with no transactions/:id/edit. Breadcrumbs point only to ancestors of s.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
77. [ ] **mifos** `/organization/employees/create` → `/remittances/process` (only this extractor, shell-only)
   - AI verdict: **unclear**; site: `src/app/core/shell/sidenav/sidenav.component.html:151`
   - Reason given: The shell sidenav item routerLink ['/remittances/process'] is shown only when *ngIf="mifosRemittanceEnabled", and the target route has remittanceEnabledGuard. The flag is deployment config, and the defaults in the source disagree. assets/env.js sets it false. environment.ts treats unset as enabled, and the Docker envsubst of env.template.js yields '' when MIFOS_REMITTANCE_ENABLED is unset, which counts as enabled. So
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
78. [ ] **mifos** `/organization/exchange-rates/convert` → `/clients/:clientId/shares-accounts/create` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:238`
   - Reason given: The tray navigates to /clients/:id/shares-accounts/<account.accountId>, which is the ':shareAccountId' view route (redirecting to general), not the static 'create' route. No other trigger on s names shares create.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
79. [ ] **mifos** `/organization/working-days` → `/centers/:centerId/savings-accounts/:savingAccountId/charges` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The tray builds only /clients|groups/:id/savings-accounts/:accountId. It never uses the centers prefix for accounts and has no charges sub-route.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
80. [ ] **mifos** `/products/fixed-deposit-products/:productId/edit` → `/centers/:centerId/savings-accounts/:savingAccountId/notes` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The tray reaches only the clients or groups savings account root. It has no centers prefix and no notes sub-route. No other trigger on s names a center savings tab.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
81. [ ] **mifos** `/products/near-breach-configurations/create` → `/groups/:groupId/loans-accounts/:loanId/transactions/:id/reciept` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:198`
   - Reason given: The tray navigates only to /groups/:id/loans-accounts/:accountId, which redirects to general, with no transactions/:id/reciept.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
82. [ ] **mifos** `/settings` → `/groups/:groupId/loans-accounts/:loanId/charges/:id` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:198`
   - Reason given: SettingsComponent has no router links. The tray reaches only the loan account root, not charges/:id.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
83. [ ] **mifos** `/settings` → `/groups/:groupId/savings-accounts/:savingAccountId/transactions` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: SettingsComponent has no router links. The tray reaches only the savings account root, which redirects to general, not transactions.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
84. [ ] **mifos** `/system` → `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/datatables/:datatableName` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:228`
   - Reason given: The tray reaches only the recurring-deposit account root. SystemComponent's 'data-tables' links go to /system/data-tables. Account datatable links exist only inside the RD account view, which is not shown on /system.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
85. [ ] **mifos** `/system/codes/:id/edit` → `/clients/:clientId/savings-accounts/:savingAccountId/actions/:name` (only this extractor, shell-only)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The tray reaches only the savings account root, with no actions sub-route. Savings action navigations exist only in the savings view and transaction components, which are not shown on this screen.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
86. [ ] **mifos** `/centers/:centerId/savings-accounts/:savingAccountId/transactions/:id/datatables/:datatableName` → `/clients/:clientId/savings-accounts/:savingAccountId/datatables/:datatableName` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/savings/savings-account-view/transactions/view-transaction/view-transaction.component.ts:135`
   - Reason given: On s the shown components are ViewTransactionComponent and DatatableTransactionTabComponent. doAction cuts router.url at '/transactions', so it goes to /centers/.../savings-accounts/S/actions/<name>. The tab links are relative to the transaction. The tray's savings route lands on the account root, which redirects to 'general'. Breadcrumbs point only to ancestors under /centers. Nothing produces the client-account dat
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
87. [ ] **mifos** `/centers/:centerId/savings-accounts/:savingAccountId/transactions/:id/datatables/:datatableName` → `/loans/:loanId/transactions/:id/edit` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/savings/savings-account-view/transactions/view-transaction/view-transaction.component.ts:135`
   - Reason given: doAction stays inside the savings account (/actions/<name>), and the datatable tab has only dialogs. The shell links to /loans only as the list. The tray's loan route goes to /{clients|groups}/.../loans-accounts/{id}, never to /loans/:id/transactions/:id/edit.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
88. [ ] **mifos** `/centers/:centerId/savings-accounts/:savingAccountId/transactions/:id/general` → `/clients/:clientId/savings-accounts/:savingAccountId/transfer-funds/:standingInstructionsId/edit` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/savings/savings-account-view/transactions/view-transaction/view-transaction.component.ts:135`
   - Reason given: The general tab has only the relative 'edit' and '../../' links and navigate(['../..']), all under /centers. doAction goes to <account>/actions/<name>. The tray goes to the savings account root only. No trigger names a client standing-instruction edit route.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
89. [ ] **mifos** `/checker-inbox-and-tasks/loan-approval` → `/checker-inbox-and-tasks/client-approval` (only this extractor, other)
   - AI verdict: **real**; site: `src/app/tasks/checker-inbox-and-tasks/checker-inbox-and-tasks.component.html:27`
   - Reason given: The parent tabs component CheckerInboxAndTasksComponent stays shown on the loan-approval child. Its tab nav has [routerLink]=['./client-approval'], resolving to /checker-inbox-and-tasks/client-approval. It is permission-gated (READ_CLIENT) at runtime only.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
90. [ ] **mifos** `/clients/:clientId/fixed-deposits-accounts/:fixedDepositAccountId/transactions` → `/clients/:clientId/loans-accounts/:loanId/transfer-funds/make-account-transfer` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/loans/loans-view/loans-view.component.ts:578`
   - Reason given: On s the shown components are FixedDepositAccountViewComponent and the FD TransactionsTabComponent. Their navigations are reload() (the FD list and back to the same URL), actions/<name>, edit, ../../, the FD's own tabs, account-transfers/<id>, a transaction id and journal-entry. The only producers of loans-accounts/:id/transfer-funds/make-account-transfer are loans-view.ts:578 and the client general-tab, and neither 
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
91. [ ] **mifos** `/clients/:clientId/savings-accounts/:savingAccountId/transactions/:id/datatables/:datatableName` → `/clients/:clientId/recurring-deposits-accounts/:recurringDepositAccountId/standing-instructions/make-account-transfer` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:228`
   - Reason given: The target route exists. On s, doAction goes only to <savings account>/actions/<name> and the datatable tab opens only dialogs. The tray reaches only the recurring-deposit account root, which redirects to general. No make-account-transfer producer (loans-view, savings-account-view, client general-tab) is shown on s.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
92. [ ] **mifos** `/clients/:clientId/savings-accounts/:savingAccountId/transactions/:id/general` → `/groups/:groupId/savings-accounts/:savingAccountId/charges` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/shared/notifications-tray/notifications-tray.component.ts:208`
   - Reason given: The tray navigates to /groups/<id>/savings-accounts/<accountId>, which redirects to 'general', with no /charges. On s the general tab links ('edit', '../../') and doAction (/actions/<name>) stay under /clients. Breadcrumbs point only to ancestors.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
93. [ ] **mifos** `/groups/:groupId/savings-accounts/:savingAccountId/transactions/:id/datatables/:datatableName` → `/loans/:loanId/buy-down-fees` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/savings/savings-account-view/transactions/view-transaction/view-transaction.component.ts:135`
   - Reason given: doAction only goes to <savings account>/actions/<name>, and the datatable tab has only dialogs. buy-down-fees is reachable only through the relative tab link inside LoansViewComponent, which is not shown on s. The shell has no such link.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
94. [ ] **mifos** `/groups/:groupId/savings-accounts/:savingAccountId/transactions/:id/datatables/:datatableName` → `/system/roles-and-permissions/add` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/savings/savings-account-view/transactions/view-transaction/view-transaction.component.ts:135`
   - Reason given: doAction only goes to .../actions/<name>. The shell links reach /system and other top-level pages, the frequent-activities top-level paths, and keyboard shortcuts with fixed routes. roles-and-permissions/add is linked only from the roles page ([routerLink]=['add']) and from home/activities.ts, which feeds only the Home and Dashboard search, and neither is shown on s.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
95. [ ] **mifos** `/organization/manage-loan-originators/:id` → `/organization/manage-loan-originators/:id/edit` (only this extractor, other)
   - AI verdict: **real**; site: `src/app/organization/loan-originators/view-loan-originator/view-loan-originator.component.html:10`
   - Reason given: The Edit button has routerLink ['edit'], relative to the :id route, which resolves to :id/edit. That route exists in organization-routing. The button is behind the UPDATE_LOAN_ORIGINATOR permission only.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
96. [ ] **mifos** `/products/recurring-deposit-products/:productId/edit` → `/products/recurring-deposit-products/:productId/general` (only this extractor, other)
   - AI verdict: **real**; site: `src/app/products/recurring-deposit-products/view-recurring-deposit-product/view-recurring-deposit-product.component.html:14`
   - Reason given: The edit route is a child of the :productId route that renders ViewRecurringDepositProductComponent. Its tab-nav link ./general is therefore shown on the edit screen. After save, edit-recurring-deposit-product.component.ts:159 navigates ['../'], which redirects to general.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
97. [ ] **mifos** `/system/manage-jobs` → `/clients/:clientId/client-collateral/:collateralId` (only this extractor, other)
   - AI verdict: **spurious**; site: `src/app/system/manage-jobs/cob-workflow/loan-locked/loan-locked.component.ts:175`
   - Reason given: The hinted handler navigates to /clients/:id/loans-accounts/:loanId/general. The only client-collateral link is in the clients general-tab (html:641), which is not shown on this screen.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____

## Tier 4 — Rima et al.'s seven subjects: pairs read as not real

98. [ ] **airbus-inventory** `/login` → `/add` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/login-page/login-page.component.html`
   - Reason given: The /login route renders LoginPageComponent. Its template has no <app-main-nav>, and the shell is only <router-outlet>, so the main-nav /add link (main-nav.component.html:26) is not shown on /login. Lines 39, 52 and 53 of main-nav are a toggle button and the /login logout links, which are not shown here either. The only navigation in the login code is routeToDashboard() on authentication success, which targets 'dashb
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
99. [ ] **airbus-inventory** `/login` → `/getAllProducts` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/login-page/login-page.component.ts:63`
   - Reason given: main-nav, which holds the /getAllProducts link, is not included in the login template, so that link is not shown on /login. On HTTP success, login() calls routeToDashboard(), which navigates to 'dashboard' (router.service.ts:16). That is a separate route with URL /dashboard: it has no redirectTo and only happens to reuse GetAllProductsComponent, so the user does not land on /getAllProducts.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
100. [ ] **airbus-inventory** `/login` → `/productByCategory` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/login-page/login-page.component.html`
   - Reason given: The /productByCategory link exists only in main-nav (main-nav.component.html:11), and LoginPageComponent's template does not include <app-main-nav>. No dialog is opened from /login. Login only navigates to 'dashboard', so nothing shown on /login navigates to /productByCategory.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
101. [ ] **spring-petclinic-angular** `/pets` → `/visits/:id/edit` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/pets/pet-list/pet-list.component.ts:43`
   - Reason given: Edit Visit (visit-list html:31, which calls ts:54) is inside *ngFor over visits. On /pets, PetListComponent's pet is {} (ts:43), so [visits]="pet.visits" (pet-list html:36) is undefined and no rows are ever rendered. The trigger is never shown on /pets, and the navbar has no such link.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
102. [ ] **spring-petclinic-angular** `/owners` → `/owners/:id/edit` (only this extractor)
   - AI verdict: **spurious**; site: `src/app/owners/owner-detail/owner-detail.component.ts:60`
   - Reason given: The only navigation to /owners/:id/edit is in OwnerDetailComponent (ts:60), which is routed only at /owners/:id and is not shown on /owners. OwnerListComponent's triggers are: the name link routerLink=/owners/{{owner.id}} (html:58, plus onSelect ts:62) to /owners/:id, Add Owner (html:72, ts:66) to /owners/add, and the search form, which only fetches data. The navbar has no edit link. The reader said html:58 is the Ad
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
103. [ ] **spring-petclinic-angular** `/owners` → `/owners/:id/pets/add` (only this extractor)
   - AI verdict: **spurious**; site: `src/app/owners/owner-detail/owner-detail.component.ts:64`
   - Reason given: The only navigation to /owners/:id/pets/add is addPet in OwnerDetailComponent (ts:64), which is not shown on /owners. The owner list only navigates to /owners/:id (html:58) and /owners/add (html:72), and the navbar has no add-pet link.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
104. [ ] **ever-traduora** `/projects/:projectId` → `/projects/:projectId/translations/:localeCode` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/projects/projects.module.ts:48`
   - Reason given: The empty child path of :projectId has redirectTo 'translations' with pathMatch full. So /projects/X always resolves to /projects/X/translations, and the URL never rests on s. The only locale-code link is [routerLink]=[locale.locale.code] in ProjectLocalesComponent (project-locales.component.html:17). That component is routed at the 'translations' child, not on the path to s. The routed component on the path to s is 
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
105. [ ] **event-booking-mean** `/create-event` → `/register` (both tools)
   - AI verdict: **spurious**; site: `src/app/header/header.component.html:20`
   - Reason given: The only link to /register in the components shown on /create-event is the header's Sign up link, routerLink="/register" under *ngIf="!isLoggedIn" (header.component.html:20). AuthGuardService on the create-event route admits only when authService.isLoggedIn() (currentUser != null). currentUser is set only together with loginStatus true, either in setUser or in the constructor's sessionStorage path, so the header's is
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
106. [ ] **event-booking-mean** `/Contact` → `/create-event` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `src/app/welcome/welcome.component.html:10`
   - Reason given: The only trigger for /create-event is [routerLink]="['/create-event']" in WelcomeComponent (line 10, not 9). WelcomeComponent appears only in home.component.html, which is the '' route. On /Contact the user sees LayoutComponent (header and footer) plus ContactComponent. The header links go to '', /Contact, /login, /register and /my-Events, and logout() calls navigate('/login'). The footer links are href="#". ContactC
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
107. [ ] **event-booking-mean** `/login` → `/create-event` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `—`
   - Reason given: 'login' is a top-level route outside LayoutComponent, so the user sees only AppComponent's router-outlet and LoginComponent. login.component.html has only href="" links (to '/') and no child components. LoginComponent.onLogin's only router call is navigate(['/']). WelcomeComponent, the only source of /create-event, is not shown. Landing on '/' after login and then clicking there is a two-step path, not a direct trigg
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
108. [ ] **event-booking-mean** `/my-Events` → `/create-event` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `—`
   - Reason given: On /my-Events the user sees the Layout header and footer plus UsersMyEventsComponent. Its template's only handler is deleteUserEvent, which opens a Swal confirm and an HTTP delete and never calls the router. The header and footer have no /create-event link. The only /create-event link is in WelcomeComponent, which appears only on Home. create-event.component.ts:74 navigates the other way, to /my-Events.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
109. [ ] **event-booking-mean** `/register` → `/create-event` (only Rima et al.'s tool)
   - AI verdict: **spurious**; site: `—`
   - Reason given: 'register' is a top-level route outside LayoutComponent, so only RegisterComponent is shown. Its links are terms.html and index.html (index.html resolves to Home '/'), and onRegister navigates only to /login. None of these targets /create-event. WelcomeComponent, the only /create-event trigger, is not shown on /register.
   - Your verdict: ____ (real / spurious / unclear)  Note: ____
