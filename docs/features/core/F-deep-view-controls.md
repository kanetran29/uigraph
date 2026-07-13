# F-deep-view-controls — Reach controls in state-gated overlay sub-views (F10.2)

**Status:** in progress
**Milestone:** M10 — Modal & deep-view control reach
**Depends on:** F-modal-controls (F10.1)

## Problem

F10.1 surfaced controls inside `*Modal`/`*Dialog`-tagged overlays. But real production apps have
overlay surfaces that are **not** tagged as modals — most importantly `ProfileView`
(notification settings, add-phone, identity-verify→Stripe). It is rendered deep under the
SPA shell and gated by a **state variable**, not a tag suffix:

```tsx
// AppContent (/, depth 0) -> LandingPage (depth 1) -> ProfileView (depth 2)
{profileViewVisible && isLoggedIn && (
  <ProfileView userEmail={…} onClose={() => history.push('/')} … />
)}
```

`ProfileView` sits at depth 2, past the depth-1 control horizon, so its controls — the
verify-identity CTA (→ Stripe via `useIdentityVerification`), the phone add/verify fields,
and its `<NotificationSettings/>` subview — are never extracted. There is **no `/profile`
route** (it is a state-gated overlay inside AppContent), so there is nowhere to attribute
them to today.

## Insight

A `*Visible`-gated overlay view is functionally identical to a modal: a component, gated
by a show/visible state var, rendered over the current screen, resolving to its own
imported file. So F10.2 is **not new machinery** — it broadens F10.1's overlay detection
to also fire for a capitalized, *imported* component whose render is gated by a
`*Visible`-suffixed state var, then reuses the exact same path: create an overlay node
(`kind:'modal'` — the IR's "non-route surface" kind), pull its file out of the screen
sweep, descend its tree (depth 1 → reaches `ProfileView → NotificationSettings`), and emit
its controls under the overlay node with every nav capped to `may`.

## Design

In `extractGraph`'s Pass 1 (overlay detection), the fire condition becomes:

```
isOverlayTag = /(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag)
isGatedView  = !isOverlayTag && /^[A-Z]/.test(base)
               && gatedOverlayVar(el) matches /visible$/i
               && resolveComponentFile(cf, base) is an imported file
```

`gatedOverlayVar(el)` walks the enclosing `{ … && <Comp/>}` conjunction (handling
multi-`&&` guards like `profileViewVisible && isLoggedIn && <ProfileView/>`, which
`modalGateVar` — built for a single `{ident && …}` — does not) and returns the first guard
identifier ending in `Visible`. Everything downstream (node creation, `modalDescend`,
`emitControls(ownerId, items, forceMay=true, linkModals=false)`) is shared with F10.1.

### Why conservative (`/visible$/i`)

`{showX && <Comp/>}` is one of the most common React patterns. Firing on every conditional
render would create overlay nodes for menus, tooltips, spinners — graph blow-up (the
red-team's chief concern with a flat depth bump). Restricting the guard to a
`*Visible`-suffixed identifier targets the real overlay-view convention
(`profileViewVisible`) and leaves ordinary conditional renders at their existing depth-1
behaviour. Broader gates (`show*`, path predicates) are deferred until a real app needs
them (YAGNI).

## Guarantees (inherited from F10.1, re-tested here)

- Golden invariant safe: all edges via `pushEdge`/`pushDynamicEdge` (always witnessed);
  gated-view controls only ever `may`.
- Id stability: overlay-view controls are net-new (keyed off the overlay node id); the only
  re-homing is a `*Visible`-gated imported component already swept at depth ≤1 — same
  accepted case as F10.1, verified to orphan nothing.
- Blow-up bounded: only `*Visible`-gated imported components descend; an unrelated deep
  sibling component without a `*Visible` gate stays at depth 1.
- No-controls golden byte-identical (gated behind `opts.controls`).

## Tests (TDD, written first)

1. A `*Visible`-gated imported view (`{xVisible && <ProfileView/>}`) → an overlay node
   whose controls (verify CTA, phone input) are parented to it.
2. Multi-`&&` guard (`a && b && <View/>`) → still detected (the `modalGateVar` gap).
3. View → subview delegation (`ProfileView → NotificationSettings`) → subview controls reached.
4. Blow-up bound: a sibling `{showThing && <SharedHeader/>}` whose gate is NOT
   `*Visible`-suffixed is NOT turned into an overlay (its controls stay screen-parented).
5. Gated-view nav edges are `may`.
6. Id stability: a screen control's id is unchanged when a gated view is added.
7. No-controls golden unchanged.
