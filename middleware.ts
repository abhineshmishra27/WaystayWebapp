import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'

type Role = 'ADMIN' | 'OWNER' | 'CUSTOMER'

async function getRole(req: NextRequest) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return null

  const token = await getToken({
    req,
    secret,
    secureCookie: req.nextUrl.protocol === 'https:',
  })

  return typeof token?.role === 'string' ? (token.role as Role) : null
}

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const role = await getRole(req)
  const returnTo = `${pathname}${search}`

  if ((pathname === '/login' || pathname === '/register') && role) {
    return NextResponse.redirect(new URL('/', req.url))
  }

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

export const config = {
  matcher: [
    '/admin/:path*',
    '/owner/:path*',
    '/dashboard/:path*',
    '/booking/:path*',
    '/payment/:path*',
    '/login',
    '/register',
  ],
}
