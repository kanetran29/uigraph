// Client for the sign-up backend (see openapi.yaml). The status code drives the
// form's outcome branch, so it is returned verbatim alongside the parsed body.

/** The result of a sign-up attempt: the HTTP status and the parsed JSON body. */
export interface SignupResult {
  status: number
  body: { userId?: string; error?: string; errors?: Record<string, string> }
}

/** POST the credentials to /api/signup and return the status + parsed body. */
export async function signup(email: string, password: string, promo: string): Promise<SignupResult> {
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, promo }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
