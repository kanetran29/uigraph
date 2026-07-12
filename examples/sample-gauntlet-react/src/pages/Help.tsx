// gauntlet g03: lazily loaded route component
/** Help page loaded via React.lazy from the router. */
export default function Help() {
  return (
    <main style={{ padding: 16 }}>
      <h1>Help</h1>
      <p>Frequently asked questions.</p>
    </main>
  )
}
