import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Zëri i Rrugës | Harta Anonime',
  description: 'Hap hartën dhe dëgjo çfarë po flet qyteti. Lësho një mesazh zanor 100% anonim që zhduket pas 24 orësh.',
  openGraph: {
    title: 'Zëri i Rrugës 🎙️',
    description: 'Dikush ka lënë një zë anonim në hartë. Hape për ta dëgjuar çfarë po thuhet!',
    url: 'https://zeri-i-rruges.vercel.app/',
    siteName: 'Zëri i Rrugës',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-peaky-black text-white">{children}</body>
    </html>
  )
}
