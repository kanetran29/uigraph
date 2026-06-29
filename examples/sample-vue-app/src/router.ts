import { createRouter, createWebHistory } from 'vue-router'
import Home from './pages/Home.vue'
import Login from './pages/Login.vue'
import Dashboard from './pages/Dashboard.vue'
import Settings from './pages/Settings.vue'
import Products from './pages/Products.vue'
import Checkout from './pages/Checkout.vue'
import NotFound from './pages/NotFound.vue'
import { authGuard } from './auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/login', name: 'login', component: Login },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: Dashboard,
      beforeEnter: authGuard,
      children: [{ path: 'settings', name: 'settings', component: Settings }],
    },
    { path: '/products', name: 'products', component: Products },
    { path: '/products/:id', name: 'product', component: () => import('./pages/ProductDetail.vue') },
    { path: '/checkout', name: 'checkout', component: Checkout, beforeEnter: authGuard },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
})
