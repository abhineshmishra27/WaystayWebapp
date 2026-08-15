import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'

const updateHotelAdministrationSchema = z.object({
  ownerId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  mainPhotoId: z.string().min(1).optional(),
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is required.').max(500),
}).strict().refine(data => [data.ownerId, data.isActive, data.mainPhotoId].filter(value => value !== undefined).length === 1, {
  message: 'Change exactly one hotel administration setting at a time.',
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_APPROVE)
  if (permissionError) return permissionError

  const parsed = updateHotelAdministrationSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid hotel administration update.' }, { status: 400 })

  const { id } = await params
  const hotel = await prisma.hotel.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      images: { select: { id: true, url: true, caption: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!hotel) return NextResponse.json({ error: 'Hotel not found.' }, { status: 404 })

  if (parsed.data.ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: parsed.data.ownerId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })
    if (!owner || !owner.isActive || !hasPermission(getEffectiveRole(owner.email, owner.role), PERMISSIONS.OWNER_ACCESS)) {
      return NextResponse.json({ error: 'Hotels can only be assigned to an active OWNER or ADMIN account.' }, { status: 400 })
    }
    if (hotel.ownerId === owner.id) return NextResponse.json({ hotel: { ...hotel, owner }, unchanged: true })

    const updated = await prisma.$transaction(async transaction => {
      const result = await transaction.hotel.update({ where: { id }, data: { ownerId: owner.id }, select: { id: true, name: true, ownerId: true } })
      await transaction.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: 'HOTEL_OWNER_ASSIGNED',
          targetType: 'Hotel',
          targetId: id,
          hotelId: id,
          metadata: {
            before: { ownerId: hotel.owner.id, ownerName: hotel.owner.name, ownerEmail: hotel.owner.email },
            after: { ownerId: owner.id, ownerName: owner.name, ownerEmail: owner.email },
            reason: parsed.data.reason,
          },
        },
      })
      return result
    })
    return NextResponse.json({ hotel: { ...updated, owner } })
  }

  if (parsed.data.isActive !== undefined) {
    if (hotel.isActive === parsed.data.isActive) return NextResponse.json({ hotel, unchanged: true })
    const updated = await prisma.$transaction(async transaction => {
      const result = await transaction.hotel.update({ where: { id }, data: { isActive: parsed.data.isActive }, select: { id: true, name: true, ownerId: true, isActive: true } })
      await transaction.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: parsed.data.isActive ? 'HOTEL_ACTIVATED' : 'HOTEL_SUSPENDED',
          targetType: 'Hotel',
          targetId: id,
          hotelId: id,
          metadata: { before: { isActive: hotel.isActive }, after: { isActive: parsed.data.isActive }, reason: parsed.data.reason },
        },
      })
      return result
    })
    return NextResponse.json({ hotel: updated })
  }

  const selectedPhoto = hotel.images.find(image => image.id === parsed.data.mainPhotoId)
  if (!selectedPhoto) return NextResponse.json({ error: 'The selected main photo does not belong to this hotel.' }, { status: 400 })
  const currentMainPhoto = hotel.images[0]
  if (currentMainPhoto?.id === selectedPhoto.id) return NextResponse.json({ hotel, unchanged: true })

  const orderedImages = [selectedPhoto, ...hotel.images.filter(image => image.id !== selectedPhoto.id)]
  await prisma.$transaction(async transaction => {
    await Promise.all(orderedImages.map((image, index) => transaction.hotelImage.update({ where: { id: image.id }, data: { sortOrder: index } })))
    await transaction.auditLog.create({
      data: {
        adminId: session!.user.id,
        action: 'HOTEL_MAIN_PHOTO_CHANGED',
        targetType: 'Hotel',
        targetId: id,
        hotelId: id,
        metadata: {
          before: currentMainPhoto ? { imageId: currentMainPhoto.id, url: currentMainPhoto.url } : null,
          after: { imageId: selectedPhoto.id, url: selectedPhoto.url },
          reason: parsed.data.reason,
        },
      },
    })
  })

  return NextResponse.json({ hotel: { id: hotel.id, images: orderedImages.map((image, index) => ({ ...image, sortOrder: index })) } })
}
