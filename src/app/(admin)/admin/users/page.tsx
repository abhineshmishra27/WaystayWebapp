import { prisma } from '@/lib/db'

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    include: { _count: { select: { bookings: true, reviews: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">User management</h1>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Role</th>
              <th className="text-left p-4">Bookings</th>
              <th className="text-left p-4">Reviews</th>
              <th className="text-left p-4">Joined</th>
              <th className="text-left p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-t border-gray-50">
                <td className="p-4">
                  <p className="font-medium text-sm text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-400">{user.email}</p>
                </td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    user.role === 'ADMIN' ? 'bg-red-50 text-red-700'
                    : user.role === 'OWNER' ? 'bg-blue-50 text-blue-700'
                    : 'bg-gray-50 text-gray-700'}`}>{user.role}</span>
                </td>
                <td className="p-4 text-sm text-gray-600">{user._count.bookings}</td>
                <td className="p-4 text-sm text-gray-600">{user._count.reviews}</td>
                <td className="p-4 text-xs text-gray-400">{new Date(user.createdAt).toLocaleDateString('en-IN')}</td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded-full ${user.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'}`}>
                    {user.isActive ? 'Active' : 'Suspended'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
