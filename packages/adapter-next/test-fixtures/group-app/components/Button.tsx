export interface ButtonProps {
  href: string
  children: React.ReactNode
}

export function Button({ href, children }: ButtonProps) {
  return <a href={href}>{children}</a>
}
