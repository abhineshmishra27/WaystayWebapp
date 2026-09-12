import ChannelConnectionTable from '@/components/admin/ChannelConnectionTable'
import { requireAdminSession } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'

/**
 * Channel manager connections.
 *
 * Deliberately not part of /admin/partners: that page reviews people applying to list
 * their hotel, which is a different thing that happens to share the word "partner".
 */

export const dynamic = 'force-dynamic'

const RECENT_LOG_LIMIT = 25

export default async function AdminChannelsPage() {
  await requireAdminSession()

  const [connections, recentLogs, candidateOwners] = await Promise.all([
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
        owner: { select: { id: true, name: true, email: true } },
        hotels: { select: { id: true, name: true, isApproved: true } },
        _count: { select: { roomMappings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.channelSyncLog.findMany({
      select: { id: true, connectionId: true, kind: true, outcome: true, message: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: RECENT_LOG_LIMIT,
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // Role alone is not the rule elsewhere in the app, so the same permission check is
  // applied here rather than assuming every OWNER row qualifies.
  const owners = candidateOwners
    .filter(user => hasPermission(getEffectiveRole(user.email, user.role), PERMISSIONS.OWNER_ACCESS))
    .map(({ id, name, email }) => ({ id, name, email }))

  const cloudbedsConfigured = Boolean(
    process.env.CLOUDBEDS_CLIENT_ID && process.env.CLOUDBEDS_REDIRECT_URI && process.env.CHANNEL_CREDENTIALS_KEY,
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Channel managers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Properties imported from a channel manager. Imported hotels arrive unapproved and stay
          hidden until you approve them under Hotels.
        </p>
      </header>

      <ChannelConnectionTable
        connections={connections.map(connection => ({
          ...connection,
          lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        }))}
        recentLogs={recentLogs.map(log => ({ ...log, createdAt: log.createdAt.toISOString() }))}
        owners={owners}
        cloudbedsConfigured={cloudbedsConfigured}
      />
    </div>
  )
}
