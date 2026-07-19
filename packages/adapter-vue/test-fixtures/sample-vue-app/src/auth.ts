import type { RouteLocationNormalized, NavigationGuardNext } from 'vue-router'

/** Whether a session token is present (stand-in for real auth). */
export function isAuthenticated(): boolean {
  return localStorage.getItem('token') != null
}

/** Per-route guard: allow navigation only when authenticated, else redirect to login. */
export function authGuard(_to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext): void {
  if (isAuthenticated()) next()
  else next('/login')
}
