import { prisma } from '@/lib/db'
import HotelManagementTable from '@/components/admin/HotelManagementTable'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'
import { requireAdminSession } from '@/lib/admin-auth'

export default async function AdminHotelsPage() {
  await requireAdminSession()
  const hotels = await prisma.hotel.findMany({
    include: {
      owner: { select: { id: true, name: true, email: true } },
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      rooms: { select: { price_3h: true }, where: { isActive: true }, orderBy: { price_3h: 'asc' }, take: 1 },
      _count: { select: { rooms: true, reviews: true, images: true } },
      auditLogs: {
        where: { action: { in: ['HOTEL_APPROVED', 'HOTEL_REJECTED'] } },
        select: { action: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ isApproved: 'asc' }, { createdAt: 'desc' }],
  })

  const currentOwnerIds = [...new Set(hotels.map(hotel => hotel.ownerId))]
  const owners = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: currentOwnerIds } },
        { isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, isActive: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  })

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-semibold text-gray-900">Hotel administration</h1><p className="mt-1 text-sm text-gray-500">Review submissions, manage approval decisions, and assign verified owners.</p></div>
      <HotelManagementTable
        initialHotels={hotels.map(hotel => ({
          id: hotel.id,
          name: hotel.name,
          city: hotel.city,
          state: hotel.state,
          address: hotel.address,
          lat: hotel.lat,
          lng: hotel.lng,
          rating: hotel.rating_avg,
          price3h: hotel.rooms[0]?.price_3h ?? null,
          image: hotel.images[0]?.url ?? null,
          owner: hotel.owner,
          approvalStatus: hotel.isApproved ? 'APPROVED' as const : hotel.auditLogs[0]?.action === 'HOTEL_REJECTED' ? 'REJECTED' as const : 'PENDING' as const,
          isActive: hotel.isActive,
          createdAt: hotel.createdAt.toISOString(),
          counts: { rooms: hotel._count.rooms, reviews: hotel._count.reviews, photos: hotel._count.images },
        }))}
        ownerOptions={owners.map(owner => {
          const role = getEffectiveRole(owner.email, owner.role)
          return { id: owner.id, name: owner.name, email: owner.email, role, eligible: owner.isActive && hasPermission(role, PERMISSIONS.OWNER_ACCESS) }
        })}
      />
    </div>
  )
}
