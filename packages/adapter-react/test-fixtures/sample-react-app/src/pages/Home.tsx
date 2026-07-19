import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function Home() {
  const [query, setQuery] = useState('')
  return (
    <div>
      <h1>Home</h1>
      <input
        name="search"
        placeholder="Search"
        value={query}
        onKeyDown={(e) => setQuery(e.currentTarget.value)}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Link to="/login">Login</Link>
      <Link to="/products">Products</Link>
      <Link to="/showcase">Showcase</Link>
    </div>
  )
}
