import type { FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

// gauntlet g11: data-driven target — navigation path arrives via props
/** Button whose navigation target is supplied by the parent as a prop. */
function ReturnLink({ returnTo }: { returnTo: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(returnTo)}>Return</button>
}

/** Product detail exercising props-driven, form-submit, and history-back navigation. */
export default function ProductDetail() {
  const navigate = useNavigate()
  const { productId } = useParams()
  const [searchParams] = useSearchParams()

  // gauntlet g19: form submit nav — POST to the API, then navigate
  /** Places the order via the API and moves on to checkout. */
  async function onBuySubmit(e: FormEvent) {
    e.preventDefault()
    await fetch('/api/checkout', { method: 'POST' })
    navigate('/checkout')
  }

  return (
    <div>
      <h2>Product {productId}</h2>

      {/* gauntlet g19: buy form */}
      <form onSubmit={onBuySubmit}>
        <button type="submit">Buy now</button>
      </form>

      {/* gauntlet g22: history back */}
      <button onClick={() => navigate(-1)}>Back</button>

      {/* gauntlet g11: return target comes from data, passed down as a prop */}
      <ReturnLink returnTo={searchParams.get('return') ?? '/products'} />
    </div>
  )
}
