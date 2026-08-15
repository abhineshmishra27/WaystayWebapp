'use client'

import { useMemo, useState } from 'react'
import type { Role } from '@prisma/client'
import toast, { Toaster } from 'react-hot-toast'
import { ADMIN_ROLE_CHANGE_CONFIRMATION, isPrimaryAdmin } from '@/lib/rbac'
import Link from 'next/link'

type ManagedUser = {
  id: string
  name: string
  email: string
  phone: string | null
  role: Role
  isActive: boolean
  createdAt: string
  counts: { bookings: number; reviews: number; hotels: number }
}

const roles: Role[] = ['CUSTOMER', 'OWNER', 'ADMIN']

export default function UserManagementTable({ initialUsers, currentAdminId }: { initialUsers: ManagedUser[]; currentAdminId: string }) {
  const [users, setUsers] = useState(initialUsers)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL')
  const [savingId, setSavingId] = useState<string | null>(null)

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter(user => {
      const matchesRole = roleFilter === 'ALL' || user.role === roleFilter
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? user.isActive : !user.isActive)
      const matchesQuery = !needle || [user.name, user.email, user.phone || ''].some(value => value.toLowerCase().includes(needle))
      return matchesRole && matchesStatus && matchesQuery
    })
  }, [query, roleFilter, statusFilter, users])

  async function updateUser(userId: string, changes: { role?: Role; isActive?: boolean }) {
    const currentUser = users.find(user => user.id === userId)
    if (!currentUser) return

    const changesAdminRole = changes.role !== undefined && changes.role !== currentUser.role && (changes.role === 'ADMIN' || currentUser.role === 'ADMIN')
    if (changesAdminRole) {
      const action = changes.role === 'ADMIN' ? 'promote' : 'demote'
      if (!window.confirm(`Confirm that you want to ${action} ${currentUser.name} (${currentUser.email}) ${changes.role === 'ADMIN' ? 'to' : 'from'} administrator access.`)) return
    }
    if (changes.isActive === false && !window.confirm(`Suspend ${currentUser.name}? They will lose access to Waystay until reactivated.`)) return
    const reason = window.prompt(`Reason for changing access for ${currentUser.name}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSavingId(userId)
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...changes,
          reason: reason.trim(),
          ...(changesAdminRole ? { adminRoleConfirmation: ADMIN_ROLE_CHANGE_CONFIRMATION } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this user.')
      setUsers(current => current.map(user => user.id === userId
        ? { ...user, role: data.user.role, isActive: data.user.isActive }
        : user))
      toast.success('User access updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this user.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, email or mobile" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as 'ALL' | Role)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500">
          <option value="ALL">All roles</option>
          {roles.map(role => <option key={role} value={role}>{role}</option>)}
        </select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'ALL' | 'ACTIVE' | 'SUSPENDED')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500">
          <option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
        <table className="w-full min-w-[900px]">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr><th className="p-4 text-left">User</th><th className="p-4 text-left">Role</th><th className="p-4 text-left">Activity</th><th className="p-4 text-left">Joined</th><th className="p-4 text-left">Status</th><th className="p-4 text-left">Actions</th></tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => {
              const protectedAdmin = isPrimaryAdmin(user.email)
              const currentAdmin = user.id === currentAdminId
              const saving = savingId === user.id
              return (
                <tr key={user.id} className="border-t border-gray-100 align-middle">
                  <td className="p-4"><p className="text-sm font-medium text-gray-900">{user.name}</p><p className="text-xs text-gray-500">{user.email}</p><p className="text-xs text-gray-400">{user.phone || 'No mobile number'}</p>{protectedAdmin && <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">PRIMARY ADMIN</span>}{currentAdmin && <span className="ml-1 mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">CURRENT SESSION</span>}</td>
                  <td className="p-4"><div className={`mb-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${user.role === 'ADMIN' ? 'bg-red-50 text-red-700' : user.role === 'OWNER' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{user.role}</div><select aria-label={`Role for ${user.email}`} value={user.role} disabled={saving || protectedAdmin || currentAdmin} onChange={event => updateUser(user.id, { role: event.target.value as Role })} className="block rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold disabled:bg-gray-50 disabled:text-gray-400">{roles.map(role => <option key={role} value={role}>{role}</option>)}</select></td>
                  <td className="p-4 text-xs text-gray-500"><span>{user.counts.bookings} bookings</span><span className="mx-2">·</span><span>{user.counts.hotels} hotels</span><span className="mx-2">·</span><span>{user.counts.reviews} reviews</span></td>
                  <td className="p-4 text-xs text-gray-500">{new Date(user.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="p-4"><button type="button" disabled={saving || protectedAdmin || currentAdmin} onClick={() => updateUser(user.id, { isActive: !user.isActive })} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${user.isActive ? 'bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-700' : 'bg-red-50 text-red-700 hover:bg-green-50 hover:text-green-700'}`}>{saving ? 'Saving…' : user.isActive ? 'Active · Suspend' : 'Suspended · Activate'}</button></td>
                  <td className="p-4"><Link href={`/admin/users/${user.id}`} className="text-xs font-semibold text-indigo-600 hover:underline">View details</Link></td>
                </tr>
              )
            })}
            {filteredUsers.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-sm text-gray-500">No users match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
