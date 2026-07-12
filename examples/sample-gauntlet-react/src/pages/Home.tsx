import type { KeyboardEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'

/** Landing page exercising Link, NavLink, literal navigate, plain anchors, and keyboard nav. */
export default function Home() {
  const navigate = useNavigate()

  // gauntlet g20: keyboard nav — Enter in the search box navigates to /products
  /** Navigates to the product list when Enter is pressed. */
  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate('/products')
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Gauntlet Shop</h1>

      {/* gauntlet g04: <Link to="/pricing"> literal */}
      <Link to="/pricing">See pricing</Link>

      {/* gauntlet g05: <NavLink to="/products"> literal */}
      <NavLink to="/products">Browse products</NavLink>

      {/* gauntlet g07: useNavigate literal push in onClick handler */}
      <button onClick={() => navigate('/checkout')}>Go to checkout</button>

      {/* gauntlet g20: keyboard-driven navigation input */}
      <input placeholder="Press Enter to browse products" onKeyDown={onSearchKeyDown} />

      {/* gauntlet g18a: plain internal anchor bypassing the router */}
      <a href="/pricing">Pricing (full page reload)</a>

      {/* gauntlet g18b: external anchor in a new tab */}
      <a href="https://github.com/x" target="_blank" rel="noreferrer">
        Source on GitHub
      </a>
    </main>
  )
}
