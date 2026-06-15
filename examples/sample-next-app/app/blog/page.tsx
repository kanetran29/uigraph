import Link from 'next/link'

export default function Blog({ slug }: { slug: string }) {
  return (
    <div>
      <Link href={`/blog/${slug}`}>Read post</Link>
    </div>
  )
}
