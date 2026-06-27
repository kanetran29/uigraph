import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { signup } from '../api'
import { validateEmail, validatePassword, validateConfirm, validatePromo } from '../validation'

/**
 * The sign-up form — the whole decision tree lives here:
 *  - per-input validation (email / password / confirm / promo) shown after touch
 *  - a valid-to-submit gate (the button is disabled until every rule passes)
 *  - guarded navigations on outcome: 201 -> /welcome, 3 failed attempts -> /locked
 *  - in-place failure branches (400 / 409 / 500 / 429) that keep you on the form
 * The navigate() calls use string-literal routes so the static adapter can wire
 * them as guarded edges; the in-place branches surface as proposals/runtime.
 */
export default function Signup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [promo, setPromo] = useState('')
  const [terms, setTerms] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [attempts, setAttempts] = useState(0)
  const [serverError, setServerError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const emailError = validateEmail(email)
  const passwordError = validatePassword(password)
  const confirmError = validateConfirm(confirm, password)
  const promoError = validatePromo(promo)
  const allValid = !emailError && !passwordError && !confirmError && !promoError && terms

  function markTouched(field: string): void {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setToast(null)
    setServerError(null)
    if (!allValid) return
    if (attempts >= 3) {
      navigate('/locked')
      return
    }
    setSubmitting(true)
    const res = await signup(email, password, promo)
    setSubmitting(false)
    if (res.status === 201) {
      navigate('/welcome')
      return
    }
    setAttempts((a) => a + 1)
    if (res.status === 409) setServerError('That email is already registered.')
    else if (res.status === 400) setServerError(res.body.errors?.email ?? 'The server rejected your details.')
    else if (res.status === 429) setToast('Too many attempts — please slow down.')
    else setToast('Something went wrong — please try again.')
  }

  return (
    <div>
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => markTouched('email')}
          />
          {touched.email && emailError && <p data-testid="error-email" role="alert">{emailError}</p>}
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => markTouched('password')}
          />
          {touched.password && passwordError && <p data-testid="error-password" role="alert">{passwordError}</p>}
        </div>

        <div>
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => markTouched('confirm')}
          />
          {touched.confirm && confirmError && <p data-testid="error-confirm" role="alert">{confirmError}</p>}
        </div>

        <div>
          <label htmlFor="promo">Promo code (optional)</label>
          <input
            id="promo"
            name="promo"
            type="text"
            pattern="[A-Z0-9]{6}"
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            onBlur={() => markTouched('promo')}
          />
          {touched.promo && promoError && <p data-testid="error-promo" role="alert">{promoError}</p>}
        </div>

        <div>
          <label>
            <input
              type="checkbox"
              name="terms"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
            />
            I accept the terms
          </label>
        </div>

        <button type="submit" disabled={!allValid || submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>

      {serverError && <p data-testid="server-error" role="alert">{serverError}</p>}
      {toast && <p data-testid="toast" role="status">{toast}</p>}
      <p data-testid="attempts">attempts: {attempts}</p>
    </div>
  )
}
