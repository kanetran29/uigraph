import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Pricing from './pages/Pricing'
import ProductsLayout from './pages/ProductsLayout'
import ProductsIndex from './pages/ProductsIndex'
import ProductDetail from './pages/ProductDetail'
import Checkout from './pages/Checkout'
import Login from './pages/Login'
import Account from './pages/Account'
import NotFound from './pages/NotFound'
import ProtectedRoute from './ProtectedRoute'

// gauntlet g03: lazy route component via React.lazy(() => import(...))
const Help = lazy(() => import('./pages/Help'))

// gauntlet g01: route nodes declared through createBrowserRouter object config
/** The app's data router: object-config route table, no JSX <Routes>. */
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/pricing', element: <Pricing /> },
  // gauntlet g02: nested children (index + relative :productId) resolved via <Outlet/>
  {
    path: '/products',
    element: <ProductsLayout />,
    children: [
      { index: true, element: <ProductsIndex /> },
      { path: ':productId', element: <ProductDetail /> },
    ],
  },
  { path: '/checkout', element: <Checkout /> },
  { path: '/login', element: <Login /> },
  // gauntlet g25: /account behind the ProtectedRoute wrapper component
  {
    path: '/account',
    element: (
      <ProtectedRoute>
        <Account />
      </ProtectedRoute>
    ),
  },
  // gauntlet g03: lazy route mount point
  {
    path: '/help',
    element: (
      <Suspense fallback={<p>Loading…</p>}>
        <Help />
      </Suspense>
    ),
  },
  // gauntlet g06: <Navigate to> redirect route
  { path: '/legacy', element: <Navigate to="/pricing" replace /> },
  { path: '*', element: <NotFound /> },
])
