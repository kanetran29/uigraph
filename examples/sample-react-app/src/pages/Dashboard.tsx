import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Dashboard() {
  const { isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  if (!isAuthenticated) {
    navigate('/login')
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <Link to="/dashboard/settings">Settings</Link>
      <NavLink to="/products">Products</NavLink>
      <button
        onClick={() => {
          logout()
          navigate('/')
        }}
      >
        Logout
      </button>
    </div>
  )
}
