import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** Checkout page exercising timer redirect and window.location navigation. */
export default function Checkout() {
  const navigate = useNavigate()
  const [placed, setPlaced] = useState(false)

  // gauntlet g16: timer redirect — fires 3s after the order succeeds
  useEffect(() => {
    if (!placed) return
    const timer = setTimeout(() => navigate('/pricing'), 3000)
    return () => clearTimeout(timer)
  }, [placed, navigate])

  return (
    <main style={{ padding: 16 }}>
      <h1>Checkout</h1>

      {placed ? (
        <p>Order placed — sending you back to pricing…</p>
      ) : (
        <button onClick={() => setPlaced(true)}>Place order</button>
      )}

      {/* gauntlet g17a: external redirect via window.location.href */}
      <button
        onClick={() => {
          window.location.href = 'https://external.example.com'
        }}
      >
        Pay with ExternalPay
      </button>

      {/* gauntlet g17b: internal navigation bypassing the router via location.assign */}
      <button onClick={() => window.location.assign('/help')}>Need help?</button>
    </main>
  )
}
