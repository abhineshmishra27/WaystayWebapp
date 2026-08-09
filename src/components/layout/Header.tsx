'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import BrandLogo from '@/components/BrandLogo'
import LogoutButton from '@/components/LogoutButton'

export default function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const firstName = session?.user.name?.split(' ')[0] || 'Account'
  const authDestination = pathname === '/login' || pathname === '/register' ? '/' : pathname || '/'
  const returnTo = encodeURIComponent(authDestination)

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

  if (pathname === '/') return null

  if (pathname.startsWith('/partner')) {
    return (
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <BrandLogo className="flex shrink-0 items-center gap-2" />
          <Link href="/" className="text-sm font-semibold text-slate-600 transition hover:text-[var(--waystay-orange)]">
            Back to traveler site
          </Link>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <BrandLogo className="flex items-center gap-2 shrink-0" />

        <nav className="flex items-center gap-2 sm:gap-3">
          {!session ? (
            <>
              <Link href={`/login?returnTo=${returnTo}`} className="text-sm font-semibold text-slate-600 hover:text-[var(--waystay-blue)]">Sign in</Link>
              <Link href={`/register?returnTo=${returnTo}`} className="bg-[var(--waystay-orange)] text-white text-sm font-bold px-3.5 py-2 rounded-lg hover:bg-[var(--waystay-orange-dark)] transition">
                Signup
              </Link>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                className="group flex max-w-44 items-center gap-2 rounded-full border border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] py-1.5 pl-1.5 pr-3 text-sm font-semibold text-[var(--waystay-blue)] shadow-sm transition hover:border-[var(--waystay-orange)] hover:bg-white"
              >
                {session.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-white" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--waystay-blue)] text-xs font-semibold text-white ring-2 ring-white">
                    {session.user.name?.[0] || 'A'}
                  </span>
                )}
                <span className="truncate">{firstName}</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 stroke-[var(--waystay-orange)] transition-transform ${menuOpen ? 'rotate-180' : ''}`}>
                  <path d="M5 8l5 5 5-5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-[var(--waystay-orange-tint)] bg-white shadow-xl">
                  <div className="border-b border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-4 py-3">
                    <p className="truncate text-sm font-medium text-slate-900">{session.user.name}</p>
                    <p className="truncate text-xs text-slate-500">{session.user.email}</p>
                  </div>
                  <Link
                    href="/dashboard/profile"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-[var(--waystay-orange-soft)] hover:text-[var(--waystay-blue)]"
                  >
                    Profile
                  </Link>
                  <Link
                    href="/dashboard/bookings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-[var(--waystay-orange-soft)] hover:text-[var(--waystay-blue)]"
                  >
                    My bookings
                  </Link>
                  <div className="border-t border-[var(--waystay-orange-tint)] py-1">
                    <LogoutButton className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-60" />
                  </div>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
