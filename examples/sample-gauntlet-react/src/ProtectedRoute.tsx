import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useStore } from './store'

// gauntlet g25: ProtectedRoute wrapper (children pattern) guarding /account
/** Renders children only when a user is logged in; otherwise redirects to /login. */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useStore()
  return user ? <>{children}</> : <Navigate to="/login" replace />
}
