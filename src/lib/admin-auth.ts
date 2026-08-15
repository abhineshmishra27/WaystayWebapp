import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { PERMISSIONS, sessionHasPermission } from '@/lib/rbac'

export async function requireAdminSession() {
  const session = await auth()
  if (!session || !sessionHasPermission(session, PERMISSIONS.ADMIN_ACCESS)) {
    redirect('/login?error=unauthorized')
  }
  return session
}
