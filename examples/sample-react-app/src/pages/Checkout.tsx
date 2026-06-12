import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Checkout() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    navigate('/login')
  }

  return (
    <div>
      <h1>Checkout</h1>
      <button onClick={() => navigate('/')}>Place order</button>
    </div>
  )
}
