import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') redirect('/login')

  const links = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/hotels', label: 'Hotels' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/audit', label: 'Audit log' },
  ]

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-100 fixed h-full">
        <div className="p-5 border-b border-gray-100">
          <span className="font-bold text-indigo-600 text-lg">WayStayy</span>
          <p className="text-xs text-red-500 font-medium">Admin Portal</p>
        </div>
        <nav className="p-4 space-y-1">
          {links.map(l => (
            <Link key={l.href} href={l.href} className="block px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-indigo-600">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-4 left-4 text-xs text-gray-400">
          Logged in as {session.user.name}
        </div>
      </aside>
      <main className="ml-56 flex-1 p-8">{children}</main>
    </div>
  )
}

