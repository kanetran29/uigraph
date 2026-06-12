import { useNavigate } from 'react-router-dom'

export default function Settings() {
  const navigate = useNavigate()
  return (
    <div>
      <h1>Settings</h1>
      <button onClick={() => navigate('/dashboard')}>Back</button>
    </div>
  )
}
