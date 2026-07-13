// The app logo: the brand mark (two screens joined by transition edges and
// a third screen) plus the "UI-graph" wordmark in the
// Claude-style terracotta/ink family. Colors: terracotta is brand-fixed (#D97757),
// structure inherits theme vars so the mark reads in light and dark. The favicon
// lives in public/logo.svg (terracotta tile, legible at 16px).

/** The UI-graph logo: brand mark + wordmark, for the topbar and loading skeleton. */
export function Logo(): JSX.Element {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" fill="none" role="img" aria-label="UI-graph">
        <path d="M13 9 C 16 7.5, 18 7.2, 20.5 7" stroke="#D97757" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M25 12 C 24 16, 21 20, 18 23" stroke="var(--muted)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2.5 3" />
        <rect x="2.5" y="6" width="11" height="8" rx="2" stroke="var(--text)" strokeWidth="1.7" />
        <rect x="19" y="3.5" width="11" height="8" rx="2" fill="#D97757" />
        <rect x="10" y="20" width="11" height="8" rx="2" stroke="#D97757" strokeWidth="1.7" />
      </svg>
      <span className="logo-word">
        <span className="logo-ui">UI</span>
        <b>-graph</b>
      </span>
    </span>
  )
}
