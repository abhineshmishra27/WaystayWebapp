import { prisma } from '@/lib/db'
import UserManagementTable from '@/components/admin/UserManagementTable'
import { getEffectiveRole } from '@/lib/rbac'
import { requireAdminSession } from '@/lib/admin-auth'

export default async function AdminUsersPage() {
  const session = await requireAdminSession()
  const users = await prisma.user.findMany({
    include: { _count: { select: { bookings: true, reviews: true, hotels: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">User management</h1>
        <p className="mt-1 text-sm text-gray-500">Assign customer, hotel owner, or administrator access and control account status.</p>
      </div>
      <UserManagementTable currentAdminId={session.user.id} initialUsers={users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: getEffectiveRole(user.email, user.role),
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        counts: {
          bookings: user._count.bookings,
          reviews: user._count.reviews,
          hotels: user._count.hotels,
        },
      }))} />
    </div>
  )
}
