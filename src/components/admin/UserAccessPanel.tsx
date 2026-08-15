'use client'

import { useState } from 'react'
import type { Role } from '@prisma/client'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'
import { ADMIN_ROLE_CHANGE_CONFIRMATION, isPrimaryAdmin } from '@/lib/rbac'

const roles: Role[] = ['CUSTOMER', 'OWNER', 'ADMIN']

type UserAccess = {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
}

export default function UserAccessPanel({ initialUser, currentAdminId }: { initialUser: UserAccess; currentAdminId: string }) {
  const router = useRouter()
  const [user, setUser] = useState(initialUser)
  const [saving, setSaving] = useState(false)
  const protectedAdmin = isPrimaryAdmin(user.email)
  const currentAdmin = user.id === currentAdminId

  async function updateUser(changes: { role?: Role; isActive?: boolean }) {
    const changesAdminRole = changes.role !== undefined && changes.role !== user.role && (changes.role === 'ADMIN' || user.role === 'ADMIN')
    if (changesAdminRole) {
      const action = changes.role === 'ADMIN' ? 'promote' : 'demote'
      if (!window.confirm(`Confirm that you want to ${action} ${user.name} (${user.email}) ${changes.role === 'ADMIN' ? 'to' : 'from'} administrator access.`)) return
    }
    if (changes.isActive === false && !window.confirm(`Suspend ${user.name}? They will lose access until an administrator reactivates the account.`)) return
    const reason = window.prompt(`Reason for changing access for ${user.name}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
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
      setUser(current => ({ ...current, role: data.user.role, isActive: data.user.isActive }))
      toast.success('User access updated')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5">
      <Toaster />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold text-gray-900">Access control</h2><p className="mt-1 text-xs text-gray-500">Changes apply to the user’s active session on its next authorization check.</p></div>
        <div className="flex gap-2">{protectedAdmin && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Protected primary admin</span>}{currentAdmin && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">Current session</span>}</div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">Role
          <select value={user.role} disabled={saving || protectedAdmin || currentAdmin} onChange={event => updateUser({ role: event.target.value as Role })} className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:bg-gray-50 disabled:text-gray-400">
            {roles.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <div><p className="text-sm font-medium text-gray-700">Account status</p><button type="button" disabled={saving || protectedAdmin || currentAdmin} onClick={() => updateUser({ isActive: !user.isActive })} className={`mt-1 w-full rounded-lg px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${user.isActive ? 'bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-700' : 'bg-red-50 text-red-700 hover:bg-green-50 hover:text-green-700'}`}>{saving ? 'Saving…' : user.isActive ? 'Active · Suspend account' : 'Suspended · Reactivate account'}</button></div>
      </div>
    </section>
  )
}
