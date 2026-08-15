import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { ADMIN_ROLE_CHANGE_CONFIRMATION, getEffectiveRole, isPrimaryAdmin, PERMISSIONS, PRIMARY_ADMIN_EMAIL } from '@/lib/rbac'

const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'OWNER', 'CUSTOMER']).optional(),
  isActive: z.boolean().optional(),
  adminRoleConfirmation: z.literal(ADMIN_ROLE_CHANGE_CONFIRMATION).optional(),
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is required.').max(500),
}).strict().refine(data => data.role !== undefined || data.isActive !== undefined, {
  message: 'Provide a role or account status to update.',
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.USER_MANAGE)
  if (permissionError) return permissionError

  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid user update.' }, { status: 400 })
  }

  const { id } = await params
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, isActive: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  if (isPrimaryAdmin(target.email) && (parsed.data.role && parsed.data.role !== 'ADMIN' || parsed.data.isActive === false)) {
    return NextResponse.json({ error: 'The primary administrator cannot be demoted or suspended.' }, { status: 400 })
  }

  const currentRole = getEffectiveRole(target.email, target.role)
  const nextRole = parsed.data.role ?? currentRole
  const nextIsActive = parsed.data.isActive ?? target.isActive
  if (target.id === session!.user.id && (nextRole !== 'ADMIN' || !nextIsActive)) {
    return NextResponse.json({ error: 'You cannot demote or suspend the administrator account currently in use.' }, { status: 400 })
  }
  const changesAdminRole = nextRole !== currentRole && (nextRole === 'ADMIN' || currentRole === 'ADMIN')
  if (changesAdminRole && parsed.data.adminRoleConfirmation !== ADMIN_ROLE_CHANGE_CONFIRMATION) {
    return NextResponse.json({ error: 'Explicit confirmation is required to promote or demote an administrator.' }, { status: 400 })
  }

  if (nextRole === currentRole && nextIsActive === target.isActive) {
    return NextResponse.json({
      user: { ...target, role: currentRole },
      unchanged: true,
    })
  }
  if (currentRole === 'ADMIN' && (nextRole !== 'ADMIN' || !nextIsActive)) {
    const otherActiveAdmins = await prisma.user.count({
      where: {
        id: { not: target.id },
        isActive: true,
        OR: [
          { role: 'ADMIN' },
          { email: { equals: PRIMARY_ADMIN_EMAIL, mode: 'insensitive' } },
        ],
      },
    })
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: 'At least one active administrator must remain.' }, { status: 400 })
    }
  }

  const result = await prisma.$transaction(async transaction => {
    const user = await transaction.user.update({
      where: { id: target.id },
      data: {
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(isPrimaryAdmin(target.email) ? { role: 'ADMIN', isActive: true } : {}),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    })
    await transaction.auditLog.create({
      data: {
        adminId: session!.user.id,
        action: 'USER_ACCESS_UPDATED',
        targetType: 'User',
        targetId: target.id,
        metadata: {
          before: { role: currentRole, isActive: target.isActive },
          after: { role: getEffectiveRole(user.email, user.role), isActive: user.isActive },
          reason: parsed.data.reason,
        },
      },
    })
    return user
  })

  return NextResponse.json({
    user: { ...result, role: getEffectiveRole(result.email, result.role) },
  })
}
