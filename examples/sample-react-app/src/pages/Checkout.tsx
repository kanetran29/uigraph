import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

function ConfirmDialog(props: { open: boolean; onClose: () => void }) {
  if (!props.open) return null
  return (
    <div role="dialog">
      <p>Confirm your order?</p>
      <button onClick={props.onClose}>Cancel</button>
    </div>
  )
}

export default function Checkout() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  if (!isAuthenticated) {
    navigate('/login')
  }

  /**
   * Submit handler for the order form: posts to the (unimplemented) orders API
   * as a demo of api-effect extraction, then always returns to the home screen —
   * a real backend's failure response would show an error state instead, but this
   * sample has none to fail against, so both branches resolve the same way.
   */
  async function placeOrder(e: FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ email, notes }) })
      setNotes('')
      navigate('/')
    } catch {
      setError('Order failed. Try again.')
      navigate('/')
    }
  }

  async function uploadReceipt() {
    await fetch('/api/upload', { method: 'POST' })
  }

  return (
    <form onSubmit={placeOrder}>
      <h1>Checkout</h1>
      <input name="email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <textarea name="notes" placeholder="Order notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <input name="receipt" type="file" onChange={uploadReceipt} />
      <button type="button" onClick={() => setShowConfirm(true)}>
        Review
      </button>
      <button type="submit">Place order</button>
      {error ? <div role="alert">{error}</div> : null}
      <ConfirmDialog open={showConfirm} onClose={() => setShowConfirm(false)} />
    </form>
  )
}
