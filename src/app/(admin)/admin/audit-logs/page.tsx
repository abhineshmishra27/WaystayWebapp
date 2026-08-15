import { prisma } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import AuditLogTable from '@/components/admin/AuditLogTable'

function metadataObject(metadata: unknown) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
}

function printable(value: unknown, fallback: string) {
  if (value === undefined || value === null) return fallback
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export default async function AdminAuditLogsPage() {
  await requireAdminSession()
  const logs = await prisma.auditLog.findMany({
    include: { admin: { select: { id: true, name: true, email: true } }, hotel: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  const userTargetIds = [...new Set(logs.filter(log => log.targetType === 'User').map(log => log.targetId))]
  const bookingTargetIds = [...new Set(logs.filter(log => log.targetType === 'Booking').map(log => log.targetId))]
  const reviewTargetIds = [...new Set(logs.filter(log => log.targetType === 'Review').map(log => log.targetId))]
  const [targetUsers, targetBookings, targetReviews] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userTargetIds } }, select: { id: true, name: true, email: true } }),
    prisma.booking.findMany({ where: { id: { in: bookingTargetIds } }, select: { id: true, guestName: true, roomSlot: { select: { room: { select: { hotel: { select: { name: true } } } } } } } }),
    prisma.review.findMany({ where: { id: { in: reviewTargetIds } }, select: { id: true, title: true, hotel: { select: { name: true } } } }),
  ])
  const userById = new Map(targetUsers.map(user => [user.id, user]))
  const bookingById = new Map(targetBookings.map(booking => [booking.id, booking]))
  const reviewById = new Map(targetReviews.map(review => [review.id, review]))

  const entries = logs.map(log => {
    const metadata = metadataObject(log.metadata)
    const targetUser = userById.get(log.targetId)
    const targetBooking = bookingById.get(log.targetId)
    const targetReview = reviewById.get(log.targetId)
    const targetLabel = log.targetType === 'Hotel'
      ? log.hotel?.name || `Hotel ${log.targetId}`
      : log.targetType === 'Booking' && targetBooking
        ? `${targetBooking.roomSlot.room.hotel.name} · ${targetBooking.guestName}`
        : log.targetType === 'Review' && targetReview
          ? `${targetReview.hotel.name} · ${targetReview.title}`
          : targetUser ? `${targetUser.name} (${targetUser.email})` : `${log.targetType} ${log.targetId}`
    const before = metadata.before ?? (metadata.previousRole !== undefined ? { role: metadata.previousRole, isActive: metadata.previousIsActive } : undefined)
    const after = metadata.after ?? (log.action === 'PRIMARY_ADMIN_BOOTSTRAPPED' ? { role: 'ADMIN', isActive: true } : undefined)
    return {
      id: log.id,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      targetLabel,
      targetHref: log.targetType === 'Hotel' ? `/admin/hotels/${log.targetId}` : log.targetType === 'User' ? `/admin/users/${log.targetId}` : log.targetType === 'Booking' ? `/admin/bookings/${log.targetId}` : log.targetType === 'Review' ? '/admin/reviews' : null,
      adminName: log.admin.name,
      adminEmail: log.admin.email,
      reason: typeof metadata.reason === 'string' && metadata.reason.trim() ? metadata.reason : log.action === 'PRIMARY_ADMIN_BOOTSTRAPPED' ? 'Initial administrator bootstrap.' : 'No reason recorded by the legacy action.',
      before: printable(before, 'Not recorded'),
      after: printable(after, 'Not recorded'),
      createdAt: log.createdAt.toISOString(),
    }
  })

  return <div><div className="mb-6"><h1 className="text-2xl font-semibold text-gray-900">Administrative audit logs</h1><p className="mt-1 text-sm text-gray-500">Sensitive access and hotel operations with actor, target, old and new values, reason, and timestamp.</p></div><AuditLogTable entries={entries} /></div>
}
