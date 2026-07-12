import { Outlet } from 'react-router-dom'

// gauntlet g02: layout route resolving nested children through <Outlet/>
/** Shared layout for the /products subtree. */
export default function ProductsLayout() {
  return (
    <section style={{ padding: 16 }}>
      <h1>Products</h1>
      <Outlet />
    </section>
  )
}
