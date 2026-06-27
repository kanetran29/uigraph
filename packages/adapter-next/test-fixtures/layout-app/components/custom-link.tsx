import Link from 'next/link'

const CustomLink = ({ href, children }: { href: string; children: React.ReactNode }) => {
  return <Link href={href}>{children}</Link>
}

export default CustomLink
