const AUTH_ROUTES = ['/login', '/register']

export function getAuthRedirect(returnTo: string | null | undefined) {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return '/'

  const pathname = returnTo.split('?')[0].replace(/\/$/, '') || '/'
  if (AUTH_ROUTES.includes(pathname)) return '/'
  if (pathname === '/hotels') return '/'

  return returnTo
}
