import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'
import HotelAdminPanel from '@/components/admin/HotelAdminPanel'
import HotelPhotoManager from '@/components/admin/HotelPhotoManager'
import { requireAdminSession } from '@/lib/admin-auth'

function reasonFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const reason = (metadata as Record<string, unknown>).reason
  return typeof reason === 'string' && reason.trim() ? reason : null
}

export default async function AdminHotelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await params
  const hotel = await prisma.hotel.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } },
      images: { orderBy: { sortOrder: 'asc' } },
      rooms: { include: { _count: { select: { slots: true } }, slots: { where: { isBooked: false }, select: { id: true } } }, orderBy: { createdAt: 'desc' } },
      reviews: { include: { customer: { select: { name: true, email: true } }, media: true }, orderBy: { createdAt: 'desc' }, take: 20 },
      restaurant: { include: { menuItems: { orderBy: [{ category: 'asc' }, { name: 'asc' }] } } },
      auditLogs: { include: { admin: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 50 },
    },
  })
  if (!hotel) notFound()

  const latestDecision = hotel.auditLogs.find(log => ['HOTEL_APPROVED', 'HOTEL_REJECTED'].includes(log.action))
  const approvalStatus = hotel.isApproved ? 'APPROVED' as const : latestDecision?.action === 'HOTEL_REJECTED' ? 'REJECTED' as const : 'PENDING' as const
  const owners = await prisma.user.findMany({
    where: { OR: [{ id: hotel.ownerId }, { isActive: true, role: { in: ['OWNER', 'ADMIN'] } }] },
    select: { id: true, name: true, email: true, role: true, isActive: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  })
  const ownerOptions = owners.map(owner => {
    const role = getEffectiveRole(owner.email, owner.role)
    return { id: owner.id, name: owner.name, email: owner.email, role, eligible: owner.isActive && hasPermission(role, PERMISSIONS.OWNER_ACCESS) }
  })

  return (
    <div className="space-y-6">
      <div><Link href="/admin/hotels" className="text-sm font-medium text-indigo-600 hover:underline">← Back to hotels</Link><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-gray-900">{hotel.name}</h1><p className="mt-1 text-sm text-gray-500">{hotel.address}, {hotel.city}, {hotel.state} {hotel.pincode}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${hotel.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{hotel.isActive ? 'ACTIVE' : 'DEACTIVATED'}</span></div></div>

      <HotelAdminPanel hotelId={hotel.id} hotelName={hotel.name} initialOwnerId={hotel.ownerId} initialStatus={approvalStatus} isActive={hotel.isActive} ownerOptions={ownerOptions} />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Property information</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-gray-600">{hotel.description}</p><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-gray-400">Location</dt><dd className="mt-1 text-gray-800">{hotel.city}, {hotel.state}, {hotel.country}</dd></div><div><dt className="text-gray-400">Coordinates</dt><dd className="mt-1 text-gray-800">{hotel.lat}, {hotel.lng} · <a href={`https://www.google.com/maps?q=${hotel.lat},${hotel.lng}`} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline">Open map</a></dd></div><div><dt className="text-gray-400">Star rating</dt><dd className="mt-1 font-medium text-amber-600">★ {hotel.rating_avg.toFixed(1)} · {hotel.total_review} recorded reviews</dd></div><div><dt className="text-gray-400">Check-in / check-out</dt><dd className="mt-1 text-gray-800">{hotel.checkInTime} / {hotel.checkOutTime}</dd></div><div><dt className="text-gray-400">Highway property</dt><dd className="mt-1 text-gray-800">{hotel.highway_tag ? 'Yes' : 'No'}</dd></div><div><dt className="text-gray-400">GST number</dt><dd className="mt-1 text-gray-800">{hotel.gst_number || 'Not provided'}</dd></div><div><dt className="text-gray-400">License number</dt><dd className="mt-1 text-gray-800">{hotel.license_number || 'Not provided'}</dd></div></dl><div className="mt-5"><p className="text-sm text-gray-400">Amenities</p><div className="mt-2 flex flex-wrap gap-2">{hotel.amenities.map(amenity => <span key={amenity} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{amenity}</span>)}{hotel.amenities.length === 0 && <span className="text-sm text-gray-500">None provided</span>}</div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-gray-400">Check-in policy</p><p className="mt-1 text-sm text-gray-700">{hotel.checkin_policy}</p></div><div><p className="text-sm text-gray-400">Check-out policy</p><p className="mt-1 text-sm text-gray-700">{hotel.checkout_policy}</p></div></div></section>
        <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Current owner</h2><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-gray-400">Name</dt><dd className="mt-1 text-gray-800"><Link href={`/admin/users/${hotel.owner.id}`} className="font-medium text-indigo-600 hover:underline">{hotel.owner.name}</Link></dd></div><div><dt className="text-gray-400">Email</dt><dd className="mt-1 text-gray-800">{hotel.owner.email}</dd></div><div><dt className="text-gray-400">Mobile</dt><dd className="mt-1 text-gray-800">{hotel.owner.phone || 'Not provided'}</dd></div><div><dt className="text-gray-400">Role / status</dt><dd className="mt-1 text-gray-800">{getEffectiveRole(hotel.owner.email, hotel.owner.role)} · {hotel.owner.isActive ? 'Active' : 'Suspended'}</dd></div><div><dt className="text-gray-400">Submitted</dt><dd className="mt-1 text-gray-800">{hotel.createdAt.toLocaleString('en-IN')}</dd></div></dl></section>
      </div>

      <HotelPhotoManager hotelId={hotel.id} hotelName={hotel.name} initialPhotos={hotel.images.map(image => ({ id: image.id, url: image.url, caption: image.caption }))} />

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-gray-900">Rooms and slot availability</h2><span className="text-xs text-gray-500">{hotel.rooms.length} configured</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[750px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="p-3">Room</th><th className="p-3">Occupancy</th><th className="p-3">3h / 6h / 12h / day</th><th className="p-3">Available slots</th><th className="p-3">Status</th></tr></thead><tbody>{hotel.rooms.map(room => <tr key={room.id} className="border-t border-gray-100"><td className="p-3"><p className="font-medium text-gray-900">{room.name}</p><p className="text-xs text-gray-500">{room.type} · Floor {room.floor_number} · {room.area_sqft} sq ft</p></td><td className="p-3 text-gray-600">{room.maxOccupancy} guests</td><td className="p-3 text-gray-600">₹{room.price_3h} / ₹{room.price_6h} / ₹{room.price_12h} / ₹{room.priceFullDay}</td><td className="p-3 text-gray-600">{room.slots.length} available / {room._count.slots} total</td><td className="p-3 text-gray-600">{room.isActive && room.available ? 'Available' : 'Unavailable'}</td></tr>)}{hotel.rooms.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-red-600">No rooms configured.</td></tr>}</tbody></table></div></section>

      <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Restaurant and menu</h2>{hotel.restaurant ? <div className="mt-4"><p className="text-sm font-medium text-gray-900">{hotel.restaurant.name}</p><p className="mt-1 text-sm text-gray-500">{hotel.restaurant.description || 'No description'}</p><p className="mt-3 text-xs text-gray-500">{hotel.restaurant.menuItems.length} menu items · {hotel.restaurant.isActive ? 'Active' : 'Inactive'}</p><div className="mt-4 max-h-72 divide-y divide-gray-100 overflow-y-auto">{hotel.restaurant.menuItems.map(item => <div key={item.id} className="flex justify-between gap-3 py-2 text-sm"><div><p className="font-medium text-gray-800">{item.name}</p><p className="text-xs text-gray-500">{item.category} · {item.isVeg ? 'Vegetarian' : 'Non-vegetarian'} · {item.isAvailable ? 'Available' : 'Unavailable'}</p></div><span className="font-medium text-gray-700">₹{item.price}</span></div>)}</div></div> : <p className="mt-4 text-sm text-gray-500">No restaurant configured.</p>}</section><section className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-gray-900">Guest reviews</h2><Link href="/admin/reviews" className="text-xs font-semibold text-indigo-600 hover:underline">Moderate all</Link></div><div className="mt-4 divide-y divide-gray-100">{hotel.reviews.slice(0, 5).map(review => <div key={review.id} className="py-3"><div className="flex justify-between gap-2"><p className="text-sm font-medium text-gray-900">{review.title}</p><span className="text-xs font-semibold text-amber-600">{review.rating}/5</span></div><p className="mt-1 text-xs text-gray-500">{review.customer.name} · {review.createdAt.toLocaleDateString('en-IN')} · {review.status}</p><p className="mt-2 line-clamp-2 text-sm text-gray-600">{review.body}</p></div>)}{hotel.reviews.length === 0 && <p className="py-4 text-sm text-gray-500">No reviews yet.</p>}</div></section></div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-semibold text-gray-900">Decision and ownership history</h2><div className="mt-4 divide-y divide-gray-100">{hotel.auditLogs.map(log => { const reason = reasonFromMetadata(log.metadata); return <div key={log.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium text-gray-900">{log.action}</p><time className="text-xs text-gray-400">{log.createdAt.toLocaleString('en-IN')}</time></div><p className="mt-1 text-xs text-gray-500">By {log.admin.name} ({log.admin.email})</p>{reason && <p className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">Reason: {reason}</p>}</div> })}{hotel.auditLogs.length === 0 && <p className="py-6 text-sm text-gray-500">No administrative activity recorded.</p>}</div></section>
    </div>
  )
}
