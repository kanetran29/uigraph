import { Link, useNavigate } from 'react-router-dom'
import { goDashboard } from '../navigation'

const ids = ['1', '2', '3']

export default function Products() {
  const navigate = useNavigate()
  return (
    <div>
      <h1>Products</h1>
      {ids.map((id) => (
        <Link key={id} to={`/products/${id}`}>
          Product {id}
        </Link>
      ))}
      <button onClick={() => goDashboard(navigate)}>Back to dashboard</button>
    </div>
  )
}
