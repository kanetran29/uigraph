import { redirect } from 'next/navigation'

export default function Login({ done }: { done: boolean }) {
  if (done) redirect('/')
  return <div>Login</div>
}
