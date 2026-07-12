import type { NavigateFunction } from 'react-router-dom'

// gauntlet g08: cross-file helper receiving an aliased navigate function
/** Pushes the checkout route using a caller-provided navigate function. */
export function goCheckout(go: NavigateFunction) {
  go('/checkout')
}
