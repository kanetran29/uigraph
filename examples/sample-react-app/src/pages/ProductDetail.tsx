import { useNavigate } from 'react-router-dom'

export default function ProductDetail() {
  const navigate = useNavigate()
  return (
    <div>
      <h1>Product</h1>
      <button onClick={() => navigate('/checkout')}>Buy</button>
    </div>
  )
}
