// The app logo: the brand mark (a terracotta knob holding the white "UI" node-and-edge
// monogram — U is an edge between a hollow and a filled node, I an edge between a filled
// and a hollow node) plus the "UI-graph" wordmark. Terracotta is brand-fixed (#D97757);
// the wordmark inherits theme vars so it reads in light and dark. The favicon lives in
// public/logo.svg (the square knob mark, legible at 16px).

/** The UI-graph logo: brand mark + wordmark, for the topbar and loading skeleton. */
export function Logo(): JSX.Element {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" fill="none" role="img" aria-label="UI-graph">
        <circle cx="16" cy="16" r="15" fill="#D97757" />
        <svg x="6" y="8.5" width="20" height="16" viewBox="0 0 116 92" fill="none">
          <path d="M16 22 V54 C16 89, 68 89, 68 54 V22" stroke="#fff" strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeWidth="7" />
          <circle cx="68" cy="16" r="9" fill="#fff" />
          <path d="M100 22 V66" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
          <circle cx="100" cy="16" r="9" fill="#fff" />
          <circle cx="100" cy="72" r="9" fill="none" stroke="#fff" strokeWidth="7" />
        </svg>
      </svg>
      <span className="logo-word">
        <span className="logo-ui">UI</span>
        <b>-graph</b>
      </span>
    </span>
  )
}
