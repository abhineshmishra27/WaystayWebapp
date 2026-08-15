import { prisma } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import BookingManagementTable from '@/components/admin/BookingManagementTable'

export default async function AdminBookingsPage() {
  await requireAdminSession()
  const [bookings, statusCounts] = await Promise.all([
    prisma.booking.findMany({
      include: {
        customer: { select: { id: true, name: true, email: true } },
        payment: { select: { status: true, provider: true, amount: true } },
        roomSlot: { include: { room: { include: { hotel: { select: { id: true, name: true, city: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const countByStatus = new Map(statusCounts.map(item => [item.status, item._count._all]))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Booking operations</h1>
        <p className="mt-1 text-sm text-gray-500">Search stays, inspect payment state, and perform controlled administrative cancellations.</p>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const).map(status => <div key={status} className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{status}</p><p className="mt-2 text-2xl font-semibold text-gray-900">{countByStatus.get(status) ?? 0}</p></div>)}</div>
      <BookingManagementTable initialBookings={bookings.map(booking => ({
        id: booking.id,
        status: booking.status,
        totalAmount: booking.totalAmount,
        checkIn: booking.checkIn.toISOString(),
        checkOut: booking.checkOut.toISOString(),
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        guestCount: booking.guestCount,
        roomCount: booking.roomCount,
        createdAt: booking.createdAt.toISOString(),
        customer: booking.customer,
        hotel: booking.roomSlot.room.hotel,
        room: { name: booking.roomSlot.room.name },
        slot: { type: booking.roomSlot.slotType, date: booking.roomSlot.date, startTime: booking.roomSlot.startTime, endTime: booking.roomSlot.endTime },
        payment: booking.payment,
      }))} />
    </div>
  )
}
