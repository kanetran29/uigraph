import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  return (
    <div>
      <h1>Home</h1>
      <Link href="/about">About</Link>
      <Link href="/dashboard">Dashboard</Link>
      <button onClick={() => router.push('/login')}>Sign in</button>
    </div>
  )
}
