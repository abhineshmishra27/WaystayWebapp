import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  })
  const role = typeof token?.role === 'string' ? token.role : undefined
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

export const config = {
  matcher: [
    '/admin/:path*',
    '/owner/:path*',
    '/dashboard/:path*',
    '/booking/:path*',
    '/payment/:path*',
  ],
}
