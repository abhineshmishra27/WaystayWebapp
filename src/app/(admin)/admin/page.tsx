import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import { formatRupees } from '@/lib/money'

export default async function AdminDashboardPage() {
  await requireAdminSession()
  const [customers, owners, admins, activeUsers, suspendedUsers, approvedHotels, suspendedHotels, undecidedHotels, pendingPartnerApplications, pendingHotelRequests, totalBookings, activeBookings, hiddenReviews, refundPendingPayments, recentBookings] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.user.count({ where: { role: 'OWNER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.hotel.count({ where: { isApproved: true } }),
    prisma.hotel.count({ where: { isActive: false } }),
    prisma.hotel.findMany({
      where: { isApproved: false, isActive: true },
      select: { id: true, auditLogs: { where: { action: { in: ['HOTEL_APPROVED', 'HOTEL_REJECTED'] } }, select: { action: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.partnerApplication.count({ where: { status: 'PENDING' } }),
    prisma.hotelListingRequest.count({ where: { status: 'PENDING' } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
    prisma.review.count({ where: { status: 'HIDDEN' } }),
    prisma.payment.count({ where: { status: 'REFUND_PENDING' } }),
    prisma.booking.findMany({
      select: { id: true, status: true, totalAmount: true, createdAt: true, customer: { select: { name: true, email: true } }, roomSlot: { select: { room: { select: { hotel: { select: { id: true, name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ])
  const pendingHotels = undecidedHotels.filter(hotel => hotel.auditLogs[0]?.action !== 'HOTEL_REJECTED').length
  const rejectedHotels = undecidedHotels.length - pendingHotels

  const cards = [
    { label: 'Customers', value: customers, detail: 'Total customer accounts' },
    { label: 'Owners', value: owners, detail: 'Total owner accounts' },
    { label: 'Administrators', value: admins, detail: 'Total admin accounts' },
    { label: 'Active users', value: activeUsers, detail: 'Accounts with access' },
    { label: 'Suspended users', value: suspendedUsers, detail: 'Accounts without access' },
    { label: 'Approved hotels', value: approvedHotels, detail: 'Approved properties' },
    { label: 'Pending hotels', value: pendingHotels, detail: 'Awaiting approval' },
    { label: 'Partner applications', value: pendingPartnerApplications, detail: 'Awaiting owner approval' },
    { label: 'Hotel listing requests', value: pendingHotelRequests, detail: 'Additional properties to review' },
    { label: 'Suspended hotels', value: suspendedHotels, detail: 'Listings currently unavailable' },
    { label: 'Total bookings', value: totalBookings, detail: 'All booking statuses' },
    { label: 'Active bookings', value: activeBookings, detail: 'Pending or confirmed stays' },
    { label: 'Hidden reviews', value: hiddenReviews, detail: 'Not visible on public pages' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Admin dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Waystay users, property approvals, and booking operations.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(card => <div key={card.label} className="rounded-2xl border border-gray-100 bg-white p-5"><p className="text-sm text-gray-500">{card.label}</p><p className="mt-2 text-3xl font-semibold text-gray-900">{card.value}</p><p className="mt-1 text-xs text-gray-400">{card.detail}</p></div>)}</div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-gray-900">Recent bookings</h2><p className="mt-1 text-xs text-gray-500">Latest booking activity across Waystay.</p></div><Link href="/admin/bookings" className="text-xs font-semibold text-indigo-600 hover:underline">View all</Link></div><div className="mt-4 divide-y divide-gray-100">{recentBookings.map(booking => <Link href={`/admin/bookings/${booking.id}`} key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-gray-50"><div><p className="text-sm font-medium text-gray-900">{booking.roomSlot.room.hotel.name}</p><p className="text-xs text-gray-500">{booking.customer.name} · {booking.customer.email}</p></div><div className="text-right"><p className="text-sm font-medium text-gray-800">₹{formatRupees(booking.totalAmount)}</p><p className="text-xs text-gray-500">{booking.status} · {booking.createdAt.toLocaleString('en-IN')}</p></div></Link>)}{recentBookings.length === 0 && <p className="py-6 text-sm text-gray-500">No bookings yet.</p>}</div></section>

        <div className="space-y-6"><section className="rounded-2xl border border-amber-100 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">Pending administrative actions</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><dt className="text-amber-800">Partner applications</dt><dd className="font-bold text-amber-950">{pendingPartnerApplications}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Additional hotel requests</dt><dd className="font-bold text-amber-950">{pendingHotelRequests}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Hotels awaiting approval</dt><dd className="font-bold text-amber-950">{pendingHotels}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Rejected hotels</dt><dd className="font-bold text-amber-950">{rejectedHotels}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Suspended listings</dt><dd className="font-bold text-amber-950">{suspendedHotels}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Suspended users</dt><dd className="font-bold text-amber-950">{suspendedUsers}</dd></div><div className="flex justify-between"><dt className="text-amber-800">Refunds needing reconciliation</dt><dd className="font-bold text-amber-950">{refundPendingPayments}</dd></div></dl></section><section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><h2 className="font-semibold text-indigo-950">Quick actions</h2><div className="mt-4 flex flex-col gap-2"><Link href="/admin/partners" className="rounded-lg bg-orange-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-orange-700">Review partner requests</Link><Link href="/admin/users" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700">Manage users</Link><Link href="/admin/hotels" className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Review hotel approvals</Link><Link href="/admin/bookings" className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Manage bookings</Link><Link href="/admin/reviews" className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Moderate reviews</Link><Link href="/admin/audit-logs" className="px-4 py-2 text-center text-sm font-semibold text-indigo-700 hover:underline">View audit logs</Link></div></section></div>
      </div>
    </div>
  )
}
