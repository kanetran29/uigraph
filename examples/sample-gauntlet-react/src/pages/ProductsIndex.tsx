import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** Product list exercising template-prefix, object-form, and modal-confirm navigation. */
export default function ProductsIndex() {
  const navigate = useNavigate()
  const [id, setId] = useState('widget-1')
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div>
      <label>
        Product id
        <input value={id} onChange={(e) => setId(e.target.value)} />
      </label>

      {/* gauntlet g24: template-prefix target with id from state */}
      <button onClick={() => navigate(`/products/${id}`)}>Open product</button>

      {/* gauntlet g23: object-form navigate with pathname + search */}
      <button onClick={() => navigate({ pathname: '/products', search: '?sort=price' })}>
        Sort by price
      </button>

      {/* gauntlet g21: modal open/close — confirm navigates, cancel closes */}
      <button onClick={() => setConfirmOpen(true)}>Quick buy</button>
      {confirmOpen && (
        <div role="dialog" aria-label="Confirm purchase">
          <p>Proceed to checkout?</p>
          <button onClick={() => navigate('/checkout')}>Confirm</button>
          <button onClick={() => setConfirmOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}
