import Link from 'next/link'

export default function Home() {
  return (
    <main>
      <Link href="/photo/1">Open photo</Link>
      <Link href="/dashboard">Dashboard</Link>
    </main>
  )
}
