'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import LogoutButton from '@/components/LogoutButton'

export default function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const role = session?.user?.role
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const navLinks = {
    CUSTOMER: [
      { href: '/dashboard/bookings', label: 'My bookings' },
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
  const accountLinks = role === 'CUSTOMER'
    ? [{ href: '/dashboard/profile', label: 'Profile' }, ...links]
    : links

  useEffect(() => {
    if (!menuOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const firstName = session?.user.name?.split(' ')[0] || 'Account'

  return (
    <header className="bg-white/95 backdrop-blur border-b border-gray-100 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-indigo-600 shrink-0">
          <Image
            src="/waystayy-icon.png"
            alt=""
            width={40}
            height={40}
            priority
            className="h-10 w-10 rounded-xl object-cover"
          />
          <span>WayStayy</span>
        </Link>

        <nav className="flex items-center gap-1 rounded-xl bg-gray-50 border border-gray-100 p-1 overflow-x-auto">
          <Link
            href="/hotels"
            className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive('/hotels') ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-indigo-600 hover:bg-white'
            }`}
          >
            Find Hotels
          </Link>
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive(l.href) ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-indigo-600 hover:bg-white'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {!session ? (
            <>
              <Link href="/login" className="hidden sm:block text-sm text-gray-600 hover:text-indigo-600">Sign in</Link>
              <Link href="/register" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Get started</Link>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-1.5 pr-3 text-sm font-medium text-gray-700 shadow-sm hover:border-indigo-100 hover:text-indigo-600"
              >
                {session.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.avatarUrl} alt={session.user.name || 'Profile'} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-medium text-sm">
                    {session.user.name?.[0]}
                  </div>
                )}
                <span className="hidden sm:block max-w-24 truncate">{firstName}</span>
                <span className={`text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-52 z-50">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900 truncate">{session.user.name}</p>
                    <p className="text-xs text-gray-400 truncate">{session.user.email}</p>
                  </div>
                  {accountLinks.map(l => (
                    <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-indigo-600">{l.label}</Link>
                  ))}
                  <hr className="my-1 border-gray-100" />
                  <LogoutButton className="block w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 disabled:opacity-60" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
