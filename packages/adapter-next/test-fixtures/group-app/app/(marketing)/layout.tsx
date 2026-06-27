import { Button } from '../../components/Button'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav>
        <Button href="/pricing">Pricing</Button>
        <Button href="https://github.com/example/repo">GitHub</Button>
      </nav>
      {children}
    </div>
  )
}
