import { useSyncExternalStore } from 'react'

/** App-wide auth state held by the hand-rolled store. */
export interface StoreState {
  user: string | null
}

/** Actions understood by the store. */
export type StoreAction = { type: 'LOGIN'; user: string } | { type: 'LOGOUT' }

let state: StoreState = { user: null }

const listeners = new Set<(action: StoreAction) => void>()

/** Returns the current store state snapshot. */
export function getState(): StoreState {
  return state
}

/** Applies an action to the state and notifies all listeners. */
export function dispatch(action: StoreAction) {
  state = action.type === 'LOGIN' ? { user: action.user } : { user: null }
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
