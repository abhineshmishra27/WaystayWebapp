import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Everything /admin/channels needs to show the state of each connection, plus the most
 * recent sync activity.
 *
 * Encrypted tokens are never selected. They are not needed to render anything, and a
 * field that is never read cannot be leaked by a future change to this response.
 */

export const dynamic = 'force-dynamic'

const RECENT_LOG_LIMIT = 25

export async function GET() {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.CHANNEL_MANAGE)
  if (permissionError) return permissionError

  try {
    const [connections, recentLogs] = await Promise.all([
      prisma.channelConnection.findMany({
        select: {
          id: true,
          provider: true,
          externalPropertyId: true,
          propertyName: true,
          status: true,
          currency: true,
          propertyTimezone: true,
          syncEnabled: true,
          lastSyncedAt: true,
          lastSyncError: true,
          consecutiveFailures: true,
          createdAt: true,
          owner: { select: { id: true, name: true, email: true } },
          hotels: { select: { id: true, name: true, isApproved: true, isActive: true } },
          _count: { select: { roomMappings: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.channelSyncLog.findMany({
        select: {
          id: true,
          connectionId: true,
          kind: true,
          outcome: true,
          message: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LOG_LIMIT,
      }),
    ])

    return NextResponse.json({ connections, recentLogs })
  } catch (error) {
    logger.error('api.admin.channels.list_failed', error)
    return NextResponse.json({ error: 'Failed to load channel connections' }, { status: 500 })
  }
}
