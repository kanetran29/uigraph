// The app logo: a coral 8px-radius squircle holding the white "UI" node-and-edge monogram,
// then an "UI-graph" wordmark in Space Grotesk where "UI" is currentColor (inherits the theme
// text colour, so it flips light/dark) and "-graph" is the coral brand tint. No pill, no chrome
// — the mark and one accent carry it. The favicon lives in public/logo.svg (the square knob mark).

/** The UI-graph logo lockup, for the topbar and loading skeleton. */
export function Logo(): JSX.Element {
  return (
    <svg className="logo" viewBox="0 0 156 32" fill="none" role="img" aria-label="UI-graph">
      <rect x="0" y="0" width="32" height="32" rx="8" fill="#D97757" />
      <g transform="translate(16 16) scale(0.2) translate(-58 -44)">
        <path d="M16 22 V54 C16 89, 68 89, 68 54 V22" stroke="#fff" strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeWidth="7" />
        <circle cx="68" cy="16" r="9" fill="#fff" />
        <path d="M100 22 V66" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        <circle cx="100" cy="16" r="9" fill="#fff" />
        <circle cx="100" cy="72" r="9" fill="none" stroke="#fff" strokeWidth="7" />
      </g>
      <text x="42" y="22" fontFamily="'Space Grotesk', ui-sans-serif, system-ui, sans-serif" fontSize="19" fontWeight="600" letterSpacing="-0.4">
        <tspan fill="currentColor">UI</tspan>
        <tspan fill="#D97757">-graph</tspan>
      </text>
    </svg>
  )
}
