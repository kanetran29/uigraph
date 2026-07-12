import { Link } from 'react-router-dom'

/** Catch-all 404 page. */
export default function NotFound() {
  return (
    <main style={{ padding: 16 }}>
      <h1>404 — not found</h1>
      <Link to="/">Go home</Link>
    </main>
  )
}
