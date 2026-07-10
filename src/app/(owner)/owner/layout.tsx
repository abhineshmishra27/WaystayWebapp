import type { ReactNode } from 'react'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'OWNER') redirect('/login')

  const navLinks = [
    { href: '/owner', label: 'Dashboard', icon: '⊞' },
    { href: '/owner/hotels', label: 'My Hotels', icon: '🏨' },
    { href: '/owner/hotels/new', label: 'Add Hotel', icon: '+' },
    { href: '/owner/bookings', label: 'Bookings', icon: '📋' },
    { href: '/owner/restaurant', label: 'Restaurant', icon: '🍽' },
  ]

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-60 bg-white border-r border-gray-100 flex flex-col fixed h-full">
        <div className="p-5 border-b border-gray-100">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/waystayy-icon.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-xl object-cover"
            />
            <span className="text-xl font-bold">
              <span className="text-[var(--waystay-orange)]">Way</span><span className="text-[var(--waystay-blue)]">Stayy</span>
            </span>
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">Owner Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            >
              <span>{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-800">{session.user.name}</p>
          <p className="text-xs text-gray-400">{session.user.email}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="ml-60 flex-1 p-8">{children}</main>
    </div>
  )
}

