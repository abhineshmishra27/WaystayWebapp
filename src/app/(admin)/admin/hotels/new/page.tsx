import AdminHotelCreateForm from '@/components/admin/AdminHotelCreateForm'
import { requireAdminSession } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'

export default async function AdminNewHotelPage() {
  await requireAdminSession()
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  })
  const owners = users.filter(user => hasPermission(getEffectiveRole(user.email, user.role), PERMISSIONS.OWNER_ACCESS))

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6"><h1 className="text-2xl font-semibold text-gray-900">Add hotel</h1><p className="mt-1 text-sm text-gray-500">Create a controlled hotel draft from the information supplied by an approved owner.</p></div>
      <AdminHotelCreateForm owners={owners.map(owner => ({ id: owner.id, name: owner.name, email: owner.email }))} />
    </div>
  )
}
