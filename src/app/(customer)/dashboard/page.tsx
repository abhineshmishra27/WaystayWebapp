import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PERMISSIONS, sessionHasPermission } from '@/lib/rbac'

export default async function CustomerDashboardPage() {
  const session = await auth()
  if (!session || !sessionHasPermission(session, PERMISSIONS.CUSTOMER_ACCESS)) redirect('/login?error=unauthorized')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Welcome back, {session.user.name}</h1>
        <p className="text-gray-500 mb-8">Manage your bookings and profile</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/dashboard/bookings" className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-sm transition-shadow">
            <div className="text-2xl mb-2">📋</div>
            <h2 className="font-semibold text-gray-900">My bookings</h2>
            <p className="text-sm text-gray-500 mt-1">View and manage all your hotel reservations</p>
          </Link>
          <Link href="/dashboard/profile" className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-sm transition-shadow">
            <div className="text-2xl mb-2">👤</div>
            <h2 className="font-semibold text-gray-900">My profile</h2>
            <p className="text-sm text-gray-500 mt-1">Update your personal information</p>
          </Link>
          <Link href="/hotels" className="bg-indigo-50 rounded-2xl border border-indigo-100 p-6 hover:shadow-sm transition-shadow">
            <div className="text-2xl mb-2">🔍</div>
            <h2 className="font-semibold text-indigo-700">Find a hotel</h2>
            <p className="text-sm text-indigo-400 mt-1">Search and book your next stay</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
