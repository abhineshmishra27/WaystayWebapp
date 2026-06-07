'use client'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { useState } from 'react'

export default function Header() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const [menuOpen, setMenuOpen] = useState(false)

  const navLinks = {
    CUSTOMER: [
      { href: '/dashboard/bookings', label: 'My bookings' },
      { href: '/dashboard/profile', label: 'Profile' },
    ],
    OWNER: [
      { href: '/owner/hotels', label: 'My hotels' },
      { href: '/owner/bookings', label: 'Bookings' },
    ],
    ADMIN: [
      { href: '/admin/hotels', label: 'Admin panel' },
    ],
  }

  const links = role ? (navLinks[role as keyof typeof navLinks] || []) : []

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-indigo-600">WayStayy</Link>

        <nav className="hidden md:flex items-center gap-6">
          <Link href="/hotels" className="text-sm text-gray-600 hover:text-indigo-600">Find hotels</Link>
          {links.map(l => <Link key={l.href} href={l.href} className="text-sm text-gray-600 hover:text-indigo-600">{l.label}</Link>)}
        </nav>

        <div className="flex items-center gap-3">
          {!session ? (
            <>
              <Link href="/login" className="text-sm text-gray-600 hover:text-indigo-600">Sign in</Link>
              <Link href="/register" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Get started</Link>
            </>
          ) : (
            <div className="relative">
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 text-sm text-gray-700 hover:text-indigo-600">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-medium text-sm">
                  {session.user.name?.[0]}
                </div>
                <span className="hidden md:block">{session.user.name?.split(' ')[0]}</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-44 z-50">
                  {links.map(l => (
                    <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-indigo-600">{l.label}</Link>
                  ))}
                  <hr className="my-1 border-gray-100" />
                  <button onClick={() => signOut({ callbackUrl: '/login' })}
                    className="block w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50">Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
