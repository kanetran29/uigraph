import { Link } from 'react-router-dom'

/** Landing screen — its only transition is a link into the sign-up form. */
export default function Home() {
  return (
    <div>
      <h1>Welcome</h1>
      <Link to="/signup">Create an account</Link>
    </div>
  )
}
