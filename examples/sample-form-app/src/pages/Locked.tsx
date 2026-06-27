/** Lockout screen reached after 3 failed sign-up attempts. Terminal. */
export default function Locked() {
  return (
    <div>
      <h1>Account locked</h1>
      <p data-testid="locked">Too many failed attempts. Try again later.</p>
    </div>
  )
}
