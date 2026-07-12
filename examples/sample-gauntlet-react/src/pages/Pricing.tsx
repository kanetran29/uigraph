import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { goCheckout } from '../nav-helpers'
import { ROUTES } from '../routes'
import { useStore } from '../store'

// gauntlet g10: plan-to-route record whose key is chosen at runtime
/** Maps plan ids to the route each plan continues to. */
const PLANS: Record<string, string> = {
  free: '/products',
  pro: '/checkout',
}

/** Pricing page exercising aliased, constant-map, dynamic-key, and guarded navigation. */
export default function Pricing() {
  // gauntlet g08: aliased navigate handed to a cross-file helper
  const go = useNavigate()
  const navigate = useNavigate()
  const { user } = useStore()
  const [plan, setPlan] = useState('free')

  // gauntlet g12: guarded nav — login wall in front of checkout
  /** Sends logged-out visitors to login, everyone else to checkout. */
  function onBuyClick() {
    if (!user) {
      navigate('/login')
      return
    }
    navigate('/checkout')
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Pricing</h1>

      <label>
        Plan
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </label>

      {/* gauntlet g10: dynamic key target — statically unresolvable */}
      <button onClick={() => navigate(PLANS[plan])}>Continue with plan</button>

      {/* gauntlet g09: route-constants map target */}
      <button onClick={() => navigate(ROUTES.account)}>My account</button>

      {/* gauntlet g08: helper call with the aliased navigate */}
      <button onClick={() => goCheckout(go)}>Buy via helper</button>

      {/* gauntlet g12: guarded buy button */}
      <button onClick={onBuyClick}>Buy now</button>
    </main>
  )
}
