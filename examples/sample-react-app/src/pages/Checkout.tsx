import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Checkout() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  if (!isAuthenticated) {
    navigate('/login')
  }

  async function placeOrder() {
    await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ email, notes }) })
    setNotes('')
    navigate('/')
  }

  return (
    <form onSubmit={placeOrder}>
      <h1>Checkout</h1>
      <input name="email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <textarea name="notes" placeholder="Order notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="submit">Place order</button>
    </form>
  )
}
