import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()

  function onSubmit() {
    login()
    navigate('/dashboard')
  }

  return (
    <div>
      <h1>Login</h1>
      <button onClick={onSubmit}>Sign in</button>
    </div>
  )
}
