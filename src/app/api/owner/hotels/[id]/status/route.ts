import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/rbac'

const statusSchema = z.object({ enabled: z.boolean() }).strict()

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_STATUS_MANAGE)
  if (permissionError) return permissionError

  const parsed = statusSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide a valid listing status.' }, { status: 400 })

  const { id } = await params
  const hotel = await prisma.hotel.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true, isApproved: true, isActive: true, ownerEnabled: true },
  })
  if (!hotel) return NextResponse.json({ error: 'Hotel not found.' }, { status: 404 })
  if (hotel.ownerId !== session!.user.id) return NextResponse.json({ error: 'You can only manage hotels assigned to your account.' }, { status: 403 })
  if (!hotel.isApproved) return NextResponse.json({ error: 'Only an approved hotel can be enabled or disabled.' }, { status: 400 })
  if (parsed.data.enabled && !hotel.isActive) {
    return NextResponse.json({ error: 'This listing is suspended by Waystay administration and cannot be enabled.' }, { status: 409 })
  }
  if (hotel.ownerEnabled === parsed.data.enabled) {
    return NextResponse.json({ hotel: { id: hotel.id, ownerEnabled: hotel.ownerEnabled }, unchanged: true })
  }

  const [updated] = await prisma.$transaction([
    prisma.hotel.update({ where: { id }, data: { ownerEnabled: parsed.data.enabled }, select: { id: true, ownerEnabled: true } }),
    prisma.auditLog.create({
      data: {
        adminId: session!.user.id,
        action: parsed.data.enabled ? 'OWNER_HOTEL_ENABLED' : 'OWNER_HOTEL_DISABLED',
        targetType: 'Hotel',
        targetId: hotel.id,
        hotelId: hotel.id,
        metadata: {
          before: { ownerEnabled: hotel.ownerEnabled },
          after: { ownerEnabled: parsed.data.enabled },
          reason: 'Listing availability changed by assigned hotel owner.',
        },
      },
    }),
  ])

  return NextResponse.json({ hotel: updated })
}
