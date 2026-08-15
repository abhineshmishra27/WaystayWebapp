import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEffectiveRole } from '@/lib/rbac'
import UserAccessPanel from '@/components/admin/UserAccessPanel'
import { requireAdminSession } from '@/lib/admin-auth'

function auditValues(metadata: unknown) {
  const value = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
  return {
    before: value.before ? JSON.stringify(value.before) : 'Not recorded',
    after: value.after ? JSON.stringify(value.after) : 'Not recorded',
    reason: typeof value.reason === 'string' ? value.reason : 'Legacy action without a recorded reason.',
  }
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession()
  const { id } = await params
  const [user, auditLogs] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerifiedAt: true,
        phone: true,
        phoneVerifiedAt: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        hotels: {
          select: { id: true, name: true, city: true, state: true, isApproved: true, isActive: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        bookings: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            checkIn: true,
            createdAt: true,
            roomSlot: { select: { room: { select: { hotel: { select: { id: true, name: true } } } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        reviews: {
          select: { id: true, rating: true, title: true, status: true, createdAt: true, hotel: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { bookings: true, reviews: true, hotels: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { targetType: 'User', targetId: id },
      include: { admin: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ])

  if (!user) notFound()
  const role = getEffectiveRole(user.email, user.role)

  return (
    <div className="space-y-6">
      <div><Link href="/admin/users" className="text-sm font-medium text-indigo-600 hover:underline">← Back to users</Link><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-gray-900">{user.name}</h1><p className="mt-1 text-sm text-gray-500">{user.email}{user.phone ? ` · ${user.phone}` : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${user.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{user.isActive ? 'ACTIVE' : 'SUSPENDED'}</span></div></div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[['Bookings', user._count.bookings], ['Hotels owned', user._count.hotels], ['Reviews', user._count.reviews]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-gray-100 bg-white p-5"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p></div>)}
      </div>

      <UserAccessPanel currentAdminId={session.user.id} initialUser={{ id: user.id, name: user.name, email: user.email, role, isActive: user.isActive }} />

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Account information</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-gray-400">Email verification</dt><dd className={`mt-1 font-medium ${user.emailVerifiedAt ? 'text-green-700' : 'text-amber-700'}`}>{user.emailVerifiedAt ? `Verified ${user.emailVerifiedAt.toLocaleString('en-IN')}` : 'Not verified'}</dd></div><div><dt className="text-gray-400">Mobile verification</dt><dd className={`mt-1 font-medium ${user.phoneVerifiedAt ? 'text-green-700' : 'text-amber-700'}`}>{user.phoneVerifiedAt ? `Verified ${user.phoneVerifiedAt.toLocaleString('en-IN')}` : 'Not verified'}</dd></div><div><dt className="text-gray-400">Joined</dt><dd className="mt-1 text-gray-800">{user.createdAt.toLocaleString('en-IN')}</dd></div><div><dt className="text-gray-400">Recent account activity</dt><dd className="mt-1 text-gray-800">{user.updatedAt.toLocaleString('en-IN')}</dd></div><div><dt className="text-gray-400">User ID</dt><dd className="mt-1 break-all font-mono text-xs text-gray-800">{user.id}</dd></div></dl></section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Owned hotels</h2><div className="mt-4 divide-y divide-gray-100">{user.hotels.map(hotel => <div key={hotel.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium text-gray-900">{hotel.name}</p><p className="text-xs text-gray-500">{hotel.city}, {hotel.state}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-2 py-1 text-xs ${hotel.isApproved ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{hotel.isApproved ? 'Approved' : 'Pending / rejected'}</span><Link href={`/admin/hotels/${hotel.id}`} className="text-xs font-semibold text-indigo-600 hover:underline">Review hotel</Link></div></div>)}{user.hotels.length === 0 && <p className="py-6 text-sm text-gray-500">No hotels are assigned to this user.</p>}</div></section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Recent bookings</h2><div className="mt-4 divide-y divide-gray-100">{user.bookings.map(booking => <div key={booking.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-medium text-gray-900">{booking.roomSlot.room.hotel.name}</p><p className="text-xs text-gray-500">Check-in {booking.checkIn.toLocaleString('en-IN')}</p></div><div className="text-right"><p className="font-medium text-gray-800">₹{booking.totalAmount.toLocaleString('en-IN')}</p><p className="text-xs text-gray-500">{booking.status}</p></div></div>)}{user.bookings.length === 0 && <p className="py-6 text-sm text-gray-500">No bookings yet.</p>}</div></section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Recent reviews</h2><div className="mt-4 divide-y divide-gray-100">{user.reviews.map(review => <div key={review.id} className="flex flex-wrap justify-between gap-2 py-3"><div><p className="text-sm font-medium text-gray-900">{review.title}</p><p className="text-xs text-gray-500">{review.hotel.name} · {review.createdAt.toLocaleDateString('en-IN')} · {review.status}</p></div><span className="text-xs font-semibold text-amber-600">{review.rating}/5</span></div>)}{user.reviews.length === 0 && <p className="py-6 text-sm text-gray-500">No reviews yet.</p>}</div></section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Role and account-status history</h2><div className="mt-4 divide-y divide-gray-100">{auditLogs.map(log => { const values = auditValues(log.metadata); return <div key={log.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium text-gray-900">{log.action}</p><time className="text-xs text-gray-400">{log.createdAt.toLocaleString('en-IN')}</time></div><p className="mt-1 text-xs text-gray-500">By {log.admin.name} ({log.admin.email})</p><p className="mt-2 text-xs text-gray-600">Old: {values.before}</p><p className="mt-1 text-xs text-gray-600">New: {values.after}</p><p className="mt-1 text-xs text-gray-600">Reason: {values.reason}</p></div> })}{auditLogs.length === 0 && <p className="py-6 text-sm text-gray-500">No administrative changes recorded.</p>}</div></section>
    </div>
  )
}
