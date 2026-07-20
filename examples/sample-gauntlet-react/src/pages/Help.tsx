// gauntlet g03: lazily loaded route component
/** Help page loaded via React.lazy from the router. */
export default function Help() {
  return (
    <main style={{ padding: 16 }}>
      <h1>Help</h1>
      <p>Frequently asked questions.</p>

      {/* request-evidence proof fixture: a pure api-effect self-loop (no nav, no
          modal) — the button's only effect is a network call back to this same
          screen, mirroring the a2720f6 effect-self-loop shape used to prove
          runtime request evidence end-to-end against a real dev server. */}
      <button onClick={() => void fetch('/api/save-preferences', { method: 'POST' })}>Save preferences</button>
    </main>
  )
}
