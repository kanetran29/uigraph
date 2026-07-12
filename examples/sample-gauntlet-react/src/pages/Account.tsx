import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { dispatch, subscribe, useStore } from '../store'

/** Inner account panel shown only to logged-in users. */
function AccountPanel({ user }: { user: string }) {
  return <p>Signed in as {user}</p>
}

/** Account page exercising conditional render guard and dispatch-driven navigation. */
export default function Account() {
  const navigate = useNavigate()
  const { user } = useStore()

  // gauntlet g15: the store listener navigates; the button below only dispatches
  useEffect(() => {
    return subscribe((action) => {
      if (action.type === 'LOGOUT') navigate('/')
    })
  }, [navigate])

  return (
    <main style={{ padding: 16 }}>
      <h1>Account</h1>

      {/* gauntlet g13: conditional render guard with <Navigate> */}
      {user ? <AccountPanel user={user} /> : <Navigate to="/login" replace />}

      {/* gauntlet g15: dispatch-only handler */}
      <button onClick={() => dispatch({ type: 'LOGOUT' })}>Log out</button>
    </main>
  )
}
