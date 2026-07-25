import type { Metadata } from 'next'
import { Geist, Geist_Mono, Inter } from 'next/font/google'
import './globals.css'
import Providers from '@/components/providers'
import Header from '@/components/layout/Header'
import BackButton from '@/components/layout/BackButton'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'WayStayy — Book hotels by the hour',
  description: 'Find and book hotel rooms by 3 hours, 6 hours, 12 hours, or full day',
  icons: {
    icon: '/waystay-logo.png',
    apple: '/waystay-logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <BackButton />
          {children}
        </Providers>
      </body>
    </html>
  )
}
