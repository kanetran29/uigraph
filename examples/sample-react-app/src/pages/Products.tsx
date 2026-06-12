import { Link } from 'react-router-dom'

const ids = ['1', '2', '3']

export default function Products() {
  return (
    <div>
      <h1>Products</h1>
      {ids.map((id) => (
        <Link key={id} to={`/products/${id}`}>
          Product {id}
        </Link>
      ))}
    </div>
  )
}
