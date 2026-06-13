import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname, search } = req.nextUrl
  const role = req.auth?.user?.role as string | undefined
  const returnTo = `${pathname}${search}`

  // Admin routes — only ADMIN
  if (pathname.startsWith('/admin')) {
    if (!role || role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
    }
  }

  // Owner routes — only OWNER
  if (pathname.startsWith('/owner')) {
    if (!role || role !== 'OWNER') {
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
    }
  }

  // Customer dashboard — any logged-in user
  if (pathname.startsWith('/dashboard')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  // Booking page — must be logged in
  if (pathname.startsWith('/booking')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  // Payment page — must be logged in
  if (pathname.startsWith('/payment')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/admin/:path*',
    '/owner/:path*',
    '/dashboard/:path*',
    '/booking/:path*',
    '/payment/:path*',
  ],
}
