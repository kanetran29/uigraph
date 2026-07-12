import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { dispatch, useStore } from '../store'

/** Login page exercising state-driven navigation on store change. */
export default function Login() {
  const navigate = useNavigate()
  const { user } = useStore()
  const [name, setName] = useState('')

  // gauntlet g14: state-driven nav — fires when the store user appears, not on a click
  useEffect(() => {
    if (user) navigate('/account')
  }, [user, navigate])

  /** Dispatches the login action; navigation happens in the effect above. */
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    dispatch({ type: 'LOGIN', user: name || 'guest' })
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Log in</h1>
      <form onSubmit={onSubmit}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Log in</button>
      </form>
    </main>
  )
}
