import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function ProductDetail() {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  return (
    <div>
      <h1>Product</h1>
      <button aria-pressed={hovered} onClick={() => navigate('/checkout')} onMouseEnter={() => setHovered(true)}>
        Buy
      </button>
    </div>
  )
}
