import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { type Permission, sessionHasPermission } from '@/lib/rbac'

export function requireApiPermission(session: Session | null, permission: Permission) {
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!sessionHasPermission(session, permission)) {
    return NextResponse.json({ error: 'You do not have permission to perform this action' }, { status: 403 })
  }
  return null
}
