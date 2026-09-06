import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { ChannelSyncDisabledError, importHotelFromConnection, syncAvailabilityWindow } from '@/lib/channels/sync'

/**
 * Imports a connected property, or refreshes one already imported, then pulls its
 * availability.
 *
 * The same endpoint does first import and re-import on purpose: `importHotelFromConnection`
 * upserts on the external ids, so there is no separate "create" case to get wrong, and
 * an operator retrying after a failure runs exactly the same path that succeeded before.
 *
 * Availability follows the import because a hotel with rooms but no slots is invisible
 * in search - importing alone would look like it had done nothing.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.CHANNEL_MANAGE)
  if (permissionError) return permissionError

  const { connectionId } = await params

  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, propertyName: true },
  })
  if (!connection) {
    return NextResponse.json({ error: 'Channel connection not found.' }, { status: 404 })
  }

  try {
    const imported = await importHotelFromConnection(connectionId)
    // A failure here leaves the hotel imported but unsellable, which is recoverable by
    // running again, so it is reported rather than rolled back.
    const availability = await syncAvailabilityWindow(connectionId)

    await prisma.auditLog.create({
      data: {
        adminId: session!.user.id,
        action: 'CHANNEL_CONNECTION_SYNCED',
        targetType: 'ChannelConnection',
        targetId: connectionId,
        hotelId: imported.hotelId,
        metadata: {
          roomsUpserted: imported.roomsUpserted,
          created: imported.created,
          days: availability.days,
          holdsWritten: availability.holdsWritten,
        },
      },
    })

    return NextResponse.json({
      hotelId: imported.hotelId,
      roomsUpserted: imported.roomsUpserted,
      created: imported.created,
      availability: {
        rooms: availability.rooms,
        days: availability.days,
        holdsWritten: availability.holdsWritten,
        slotsCreated: availability.slotsCreated,
      },
    })
  } catch (error) {
    if (error instanceof ChannelSyncDisabledError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    logger.error('api.admin.channels.resync_failed', error, { connectionId })
    // The detail is already in ChannelSyncLog, which the admin page renders, so the
    // message here can be specific without becoming the only record of what happened.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 502 },
    )
  }
}
