'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import BrandLogo from '@/components/BrandLogo'
import LogoutButton from '@/components/LogoutButton'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

export default function Header() {
  const { data } = useSession()
  const session = data?.user.isActive ? data : null
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const firstName = session?.user.name?.split(' ')[0] || 'Account'
  const authDestination = pathname === '/login' || pathname === '/register' ? '/' : pathname || '/'
  const returnTo = encodeURIComponent(authDestination)
  const hasOwnerAccess = hasPermission(session?.user.role, PERMISSIONS.OWNER_ACCESS)
  const hasAdminAccess = hasPermission(session?.user.role, PERMISSIONS.ADMIN_ACCESS)
  const isLandingPage = pathname === '/'
  const partnerDestination = hasOwnerAccess ? '/owner/hotels' : '/partner'

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

  if (pathname.startsWith('/partner')) {
    return (
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <BrandLogo />
          <Link href="/" className="text-sm font-semibold text-slate-600 transition hover:text-[var(--waystay-orange)]">
            Back to traveler site
          </Link>
        </div>
      </header>
    )
  }

  return (
    <header className={isLandingPage ? 'ws-landing-header relative z-40' : 'sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur'}>
      <div className={`${isLandingPage ? 'ws-landing-header-inner' : 'max-w-6xl px-4 py-3'} mx-auto flex items-center justify-between gap-4`}>
        <BrandLogo />

        <nav className="flex items-center gap-2 sm:gap-3">
          {isLandingPage && (
            <div className="hidden items-center gap-3 md:flex lg:gap-7">
              <Link href="#offers" className="rounded-lg px-2 py-2 text-sm font-bold transition hover:text-[var(--waystay-orange-dark)] lg:text-base">Offers</Link>
              <Link href="#trust" className="rounded-lg px-2 py-2 text-sm font-bold transition hover:text-[var(--waystay-orange-dark)] lg:text-base">Why travellers trust us</Link>
              <Link href={partnerDestination} className="rounded-lg px-2 py-2 text-sm font-bold transition hover:text-[var(--waystay-orange-dark)] lg:text-base">List your business</Link>
            </div>
          )}
          {!session ? (
            <Link href={`/login?returnTo=${returnTo}`} className={`${isLandingPage ? 'border border-slate-300 bg-white text-[var(--waystay-blue)] hover:border-[var(--waystay-orange)]' : 'bg-[var(--waystay-orange)] text-white hover:bg-[var(--waystay-orange-dark)]'} inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm transition`}>
              {isLandingPage && <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current"><circle cx="12" cy="8" r="4" strokeWidth="1.8" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" strokeWidth="1.8" strokeLinecap="round" /></svg>}
              {isLandingPage ? 'Log in' : <><span className="sm:hidden">Sign in</span><span className="hidden sm:inline">Sign in / Sign up</span></>}
            </Link>
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
                  {hasOwnerAccess && (
                    <Link href="/owner/hotels" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-[var(--waystay-orange-soft)] hover:text-[var(--waystay-blue)]">
                      Owner portal
                    </Link>
                  )}
                  {hasAdminAccess && (
                    <Link href="/admin" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-[var(--waystay-orange-soft)] hover:text-[var(--waystay-blue)]">
                      Admin portal
                    </Link>
                  )}
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
