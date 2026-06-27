import { Link } from 'react-router-dom'

export const Navbar = () => {
  return (
    <nav>
      <section>
        <h1>Example</h1>
        <div className="navLinks">
          <Link to="/">Home</Link>
        </div>
      </section>
    </nav>
  )
}
