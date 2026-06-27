// Pure per-field validation rules for the sign-up form. Kept as small, legible
// functions so the decision-tree guards (email empty / bad pattern / weak
// password / mismatch / bad promo) are readable both in code and as the symbolic
// guard text the UI graph records.

/** A valid email is non-empty and looks like local@domain.tld. */
export const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** A promo code, when present, must be 6 uppercase alphanumerics. */
export const promoPattern = /^[A-Z0-9]{6}$/

/** Email error code, or null when valid. */
export function validateEmail(value: string): string | null {
  if (value === '') return 'required'
  if (!emailPattern.test(value)) return 'invalid-email'
  return null
}

/** Password error code, or null when strong enough (len>=8, a digit, a symbol). */
export function validatePassword(value: string): string | null {
  const strong = value.length >= 8 && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
  return strong ? null : 'weak-password'
}

/** Confirm-password error code, or null when it equals the password. */
export function validateConfirm(value: string, password: string): string | null {
  return value === password ? null : 'mismatch'
}

/** Promo error code, or null when empty or well-formed. */
export function validatePromo(value: string): string | null {
  if (value !== '' && !promoPattern.test(value)) return 'invalid-code'
  return null
}
