// The app logo: a directed-graph mark (a violet "source" node with edges to two state
// nodes — a tiny UI-transition graph) plus the "uigraph" wordmark. The mark themes via
// CSS vars (accent / text / muted) so it reads in both light and dark. The standalone
// app-icon/favicon lives in public/logo.svg (a violet tile, always legible at 16px).

/** The uigraph logo: graph mark + wordmark, for the topbar and loading skeleton. */
export function Logo(): JSX.Element {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" fill="none" role="img" aria-label="uigraph">
        <path d="M11 12 L21.5 9 M11 12 L15 22.5" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="11" cy="12" r="4.6" fill="var(--accent)" />
        <circle cx="21.5" cy="9" r="3.3" fill="var(--text)" />
        <circle cx="15" cy="22.5" r="3.3" fill="var(--text)" />
      </svg>
      <span className="logo-word">
        ui<b>graph</b>
      </span>
    </span>
  )
}
