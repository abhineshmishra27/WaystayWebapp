import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'react-hot-toast'
import { prisma } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import AdminCancelBookingButton from '@/components/admin/AdminCancelBookingButton'

function reasonFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const reason = (metadata as Record<string, unknown>).reason
  return typeof reason === 'string' ? reason : null
}

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await params
  const [booking, auditLogs] = await Promise.all([
    prisma.booking.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
        payment: true,
        extensions: { orderBy: { createdAt: 'desc' } },
        review: { include: { media: true } },
        roomSlot: { include: { room: { include: { hotel: { include: { owner: { select: { id: true, name: true, email: true, phone: true } } } } } } } },
      },
    }),
    prisma.auditLog.findMany({
      where: { targetType: 'Booking', targetId: id },
      include: { admin: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  if (!booking) notFound()
  const hotel = booking.roomSlot.room.hotel
  const paymentLabel = booking.payment ? `${booking.payment.provider} · ${booking.payment.status}` : 'Pay at hotel'

  return (
    <div className="space-y-6">
      <Toaster />
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-gray-900">Booking details</h1><p className="mt-1 break-all font-mono text-xs text-gray-500">{booking.id}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">{booking.status}</span>{['PENDING', 'CONFIRMED'].includes(booking.status) && <AdminCancelBookingButton bookingId={booking.id} hotelName={hotel.name} paymentStatus={booking.payment?.status ?? null} />}</div></div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Stay information</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-gray-400">Hotel</dt><dd className="mt-1"><Link href={`/admin/hotels/${hotel.id}`} className="font-medium text-indigo-600 hover:underline">{hotel.name}</Link><p className="text-xs text-gray-500">{hotel.address}, {hotel.city}, {hotel.state}</p></dd></div><div><dt className="text-gray-400">Room / slot</dt><dd className="mt-1 text-gray-800">{booking.roomSlot.room.name} · {booking.roomSlot.slotType}</dd><dd className="text-xs text-gray-500">{booking.roomSlot.date} · {booking.roomSlot.startTime}–{booking.roomSlot.endTime}</dd></div><div><dt className="text-gray-400">Check-in</dt><dd className="mt-1 text-gray-800">{booking.checkIn.toLocaleString('en-IN')}</dd></div><div><dt className="text-gray-400">Check-out</dt><dd className="mt-1 text-gray-800">{booking.checkOut.toLocaleString('en-IN')}</dd></div><div><dt className="text-gray-400">Duration</dt><dd className="mt-1 text-gray-800">{booking.totalHours} hours</dd></div><div><dt className="text-gray-400">Party</dt><dd className="mt-1 text-gray-800">{booking.guestCount} guests · {booking.roomCount} rooms</dd></div></dl></section>
        <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Guest and account</h2><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-gray-400">Guest</dt><dd className="mt-1 text-gray-800">{booking.guestName}</dd></div><div><dt className="text-gray-400">Contact</dt><dd className="mt-1 text-gray-800">{booking.guestEmail}<br />{booking.guestPhone}</dd></div><div><dt className="text-gray-400">Customer account</dt><dd className="mt-1"><Link href={`/admin/users/${booking.customer.id}`} className="font-medium text-indigo-600 hover:underline">{booking.customer.name}</Link><p className="text-xs text-gray-500">{booking.customer.email} · {booking.customer.isActive ? 'Active' : 'Suspended'}</p></dd></div><div><dt className="text-gray-400">Hotel owner</dt><dd className="mt-1"><Link href={`/admin/users/${hotel.owner.id}`} className="font-medium text-indigo-600 hover:underline">{hotel.owner.name}</Link><p className="text-xs text-gray-500">{hotel.owner.email}</p></dd></div></dl></section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Payment and cancellation</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><dt className="text-gray-400">Booking amount</dt><dd className="mt-1 text-lg font-semibold text-gray-900">₹{booking.totalAmount.toLocaleString('en-IN')}</dd></div><div><dt className="text-gray-400">Payment state</dt><dd className="mt-1 text-gray-800">{paymentLabel}</dd></div><div><dt className="text-gray-400">Payment ID</dt><dd className="mt-1 break-all font-mono text-xs text-gray-700">{booking.payment?.providerPaymentId || 'Not available'}</dd></div><div><dt className="text-gray-400">Refund ID</dt><dd className="mt-1 break-all font-mono text-xs text-gray-700">{booking.payment?.providerRefundId || 'Not refunded'}</dd></div>{booking.cancelledAt && <><div><dt className="text-gray-400">Cancelled at</dt><dd className="mt-1 text-gray-800">{booking.cancelledAt.toLocaleString('en-IN')}</dd></div><div className="sm:col-span-2"><dt className="text-gray-400">Cancellation reason</dt><dd className="mt-1 text-gray-800">{booking.cancellationReason || 'Not recorded'}</dd></div></>}</dl></section>

      <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Extensions</h2><div className="mt-4 divide-y divide-gray-100">{booking.extensions.map(extension => <div key={extension.id} className="flex justify-between gap-3 py-3 text-sm"><div><p className="font-medium text-gray-800">+{extension.addedHours} hours</p><p className="text-xs text-gray-500">New checkout {extension.newCheckout.toLocaleString('en-IN')}</p></div><p className="font-medium text-gray-800">₹{extension.additionalAmount.toLocaleString('en-IN')}</p></div>)}{booking.extensions.length === 0 && <p className="py-4 text-sm text-gray-500">No booking extensions.</p>}</div></section><section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Review</h2>{booking.review ? <div className="mt-4"><div className="flex justify-between gap-3"><p className="font-medium text-gray-900">{booking.review.title}</p><span className="text-sm font-semibold text-amber-600">{booking.review.rating}/5</span></div><p className="mt-2 text-sm text-gray-600">{booking.review.body}</p><p className="mt-3 text-xs text-gray-500">{booking.review.status} · {booking.review.media.length} attachments</p><Link href="/admin/reviews" className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline">Open review moderation</Link></div> : <p className="mt-4 text-sm text-gray-500">No review was submitted for this booking.</p>}</section></div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Administrative history</h2><div className="mt-4 divide-y divide-gray-100">{auditLogs.map(log => <div key={log.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium text-gray-900">{log.action}</p><time className="text-xs text-gray-400">{log.createdAt.toLocaleString('en-IN')}</time></div><p className="mt-1 text-xs text-gray-500">By {log.admin.name} ({log.admin.email})</p>{reasonFromMetadata(log.metadata) && <p className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">Reason: {reasonFromMetadata(log.metadata)}</p>}</div>)}{auditLogs.length === 0 && <p className="py-6 text-sm text-gray-500">No administrative changes recorded for this booking.</p>}</div></section>
    </div>
  )
}
