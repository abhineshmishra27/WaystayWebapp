import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const session = await auth()
  const role = session?.user?.role
  const returnTo = `${pathname}${search}`

  if (pathname.startsWith('/admin')) {
    if (!role || role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
    }
  }

  if (pathname.startsWith('/owner')) {
    if (!role || role !== 'OWNER') {
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
    }
  }

  if (pathname.startsWith('/dashboard')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  if (pathname.startsWith('/booking')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  if (pathname.startsWith('/payment')) {
    if (!role) {
      return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url))
    }
  }

  return NextResponse.next()
}

export default middleware

export const config = {
  matcher: [
    '/admin/:path*',
    '/owner/:path*',
    '/dashboard/:path*',
    '/booking/:path*',
    '/payment/:path*',
  ],
}
