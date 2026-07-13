import { useSyncExternalStore } from 'react'

/** App-wide auth state held by the hand-rolled store. */
export interface StoreState {
  user: string | null
}

/** Actions understood by the store. */
export type StoreAction = { type: 'LOGIN'; user: string } | { type: 'LOGOUT' }

/** Rehydrate the session like a real website: auth persists across page loads. */
function initialState(): StoreState {
  try {
    return { user: window.localStorage.getItem('gauntlet.user') }
  } catch {
    return { user: null }
  }
}

let state: StoreState = initialState()

const listeners = new Set<(action: StoreAction) => void>()

/** Returns the current store state snapshot. */
export function getState(): StoreState {
  return state
}

/** Applies an action to the state, persists the session, and notifies all listeners. */
export function dispatch(action: StoreAction) {
  state = action.type === 'LOGIN' ? { user: action.user } : { user: null }
  try {
    if (state.user !== null) window.localStorage.setItem('gauntlet.user', state.user)
    else window.localStorage.removeItem('gauntlet.user')
  } catch {
    void 0
  }
  listeners.forEach((listener) => listener(action))
}

/** Registers an action listener; returns an unsubscribe function. */
export function subscribe(listener: (action: StoreAction) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook exposing the store state via useSyncExternalStore. */
export function useStore(): StoreState {
  return useSyncExternalStore((onChange) => subscribe(() => onChange()), getState)
}
