/**
 * Stands in for `@/lib/auth` during route tests.
 *
 * The real module pulls in NextAuth, which wants a request context, providers and a
 * signed cookie. Route tests care about what a handler does *given* a session, not about
 * re-testing NextAuth, so the resolver hook swaps this in and the test states the
 * session it wants directly.
 *
 * Only the session matters here - authorisation itself is still exercised for real,
 * because the handlers call the genuine requireApiPermission and rbac helpers.
 */

export type TestSession = {
  user: {
    id: string
    email: string
    name: string
    role: 'ADMIN' | 'OWNER' | 'CUSTOMER'
    isActive: boolean
    avatarUrl?: string | null
  }
} | null

let currentSession: TestSession = null

export function setTestSession(session: TestSession) {
  currentSession = session
}

export function signedInAs(
  user: { id: string; email: string; role?: 'ADMIN' | 'OWNER' | 'CUSTOMER'; name?: string },
): TestSession {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? 'Test User',
      role: user.role ?? 'CUSTOMER',
      isActive: true,
      avatarUrl: null,
    },
  }
}

/** Mirrors the real export's shape: an async function returning the session or null. */
export async function auth() {
  return currentSession
}

// Re-exported so a handler importing something else from '@/lib/auth' fails loudly with
// a missing-export error rather than silently receiving undefined.
export const handlers = {}
export const signIn = async () => {
  throw new Error('signIn is not available in route tests')
}
export const signOut = async () => {
  throw new Error('signOut is not available in route tests')
}
