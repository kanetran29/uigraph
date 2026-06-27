import Link from 'next/link'
import CustomLink from './custom-link'

export function MainNav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <CustomLink href="/dashboard">Dashboard</CustomLink>
      <a href="https://github.com/example/repo">GitHub</a>
    </nav>
  )
}
