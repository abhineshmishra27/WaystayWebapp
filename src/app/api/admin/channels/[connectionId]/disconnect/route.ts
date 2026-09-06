import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { recordSyncLog } from '@/lib/channels/sync'

/**
 * Stops syncing a connection, without destroying anything it brought in.
 *
 * Imported hotels stay, and so do their bookings: guests hold reservations against
 * those rooms, and deleting the inventory would strand them. What stops is the
 * refreshing - no more availability pulls, no more pushes.
 *
 * Channel holds are released, because a hold represents "the channel has sold this" and
 * we are no longer being told when that stops being true. Leaving them would withhold
 * rooms indefinitely on information that can only go stale.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.CHANNEL_MANAGE)
  if (permissionError) return permissionError

  const { connectionId } = await params

  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, propertyName: true, hotels: { select: { id: true } } },
  })
  if (!connection) {
    return NextResponse.json({ error: 'Channel connection not found.' }, { status: 404 })
  }

  try {
    const result = await prisma.$transaction(async tx => {
      const mappings = await tx.channelRoomMapping.findMany({
        where: { connectionId },
        select: { roomId: true },
      })
      const roomIds = mappings.map(mapping => mapping.roomId)

      const releasedHolds = roomIds.length > 0
        ? await tx.channelInventoryHold.deleteMany({ where: { roomId: { in: roomIds } } })
        : { count: 0 }

      await tx.channelConnection.update({
        where: { id: connectionId },
        data: { status: 'DISCONNECTED', syncEnabled: false },
      })

      await tx.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: 'CHANNEL_CONNECTION_DISCONNECTED',
          targetType: 'ChannelConnection',
          targetId: connectionId,
          metadata: {
            propertyName: connection.propertyName,
            hotelsRetained: connection.hotels.length,
            holdsReleased: releasedHolds.count,
          },
        },
      })

      return { holdsReleased: releasedHolds.count, hotelsRetained: connection.hotels.length }
    })

    await recordSyncLog({
      connectionId,
      kind: 'IMPORT',
      outcome: 'SUCCESS',
      message: `Disconnected. ${result.hotelsRetained} hotel(s) retained, ${result.holdsReleased} hold(s) released.`,
    })
    logger.info('api.admin.channels.disconnected', { connectionId, ...result })

    return NextResponse.json(result)
  } catch (error) {
    logger.error('api.admin.channels.disconnect_failed', error, { connectionId })
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
  }
}
