'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type OwnerOption = { id: string; name: string; email: string; role: 'CUSTOMER' | 'OWNER' | 'ADMIN'; eligible: boolean }

export default function HotelAdminPanel({
  hotelId,
  hotelName,
  initialOwnerId,
  initialStatus,
  isActive,
  ownerOptions,
}: {
  hotelId: string
  hotelName: string
  initialOwnerId: string
  initialStatus: ApprovalStatus
  isActive: boolean
  ownerOptions: OwnerOption[]
}) {
  const router = useRouter()
  const [ownerId, setOwnerId] = useState(initialOwnerId)
  const [status, setStatus] = useState(initialStatus)
  const [active, setActive] = useState(isActive)
  const [saving, setSaving] = useState(false)

  async function assignOwner(nextOwnerId: string) {
    if (nextOwnerId === ownerId) return
    const owner = ownerOptions.find(option => option.id === nextOwnerId)
    if (!owner?.eligible || !window.confirm(`Assign ${hotelName} to ${owner.name} (${owner.email})?`)) return
    const reason = window.prompt(`Reason for transferring ${hotelName} to ${owner.name}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/hotels/${hotelId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: nextOwnerId, reason: reason.trim() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update the owner.')
      setOwnerId(data.hotel.owner.id)
      toast.success('Hotel owner updated')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the owner.')
    } finally {
      setSaving(false)
    }
  }

  async function updateApproval(approved: boolean) {
    let reason: string | undefined
    if (approved) {
      if (!window.confirm(`Approve ${hotelName} and make it visible for booking?`)) return
    } else {
      const response = window.prompt(`Enter the rejection reason for ${hotelName}. This may be emailed to the owner.`)
      if (response === null) return
      reason = response.trim()
      if (reason.length < 5) return toast.error('Enter a clear rejection reason of at least 5 characters.')
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/hotels/${hotelId}/approve`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved, reason }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update approval.')
      setStatus(approved ? 'APPROVED' : 'REJECTED')
      toast.success(approved ? 'Hotel approved' : 'Hotel rejected')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update approval.')
    } finally {
      setSaving(false)
    }
  }

  async function updateListingStatus(nextActive: boolean) {
    const action = nextActive ? 'activate' : 'suspend'
    if (!window.confirm(`Confirm that you want to ${action} ${hotelName}.`)) return
    const reason = window.prompt(`Reason to ${action} ${hotelName}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/hotels/${hotelId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: nextActive, reason: reason.trim() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update listing status.')
      setActive(nextActive)
      toast.success(nextActive ? 'Hotel activated' : 'Hotel suspended')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update listing status.')
    } finally {
      setSaving(false)
    }
  }

  const statusClass = status === 'APPROVED' ? 'bg-green-50 text-green-700' : status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5">
      <Toaster />
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900">Administrative controls</h2><p className="mt-1 text-xs text-gray-500">Owner assignments and approval decisions are recorded in the audit log.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{status}</span></div>
      {!active && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">This hotel is suspended. Approval decisions are disabled until it is activated.</p>}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
        <label className="text-sm font-medium text-gray-700">Assigned owner<select value={ownerId} disabled={saving} onChange={event => assignOwner(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:bg-gray-50">{ownerOptions.map(owner => <option key={owner.id} value={owner.id} disabled={!owner.eligible}>{owner.name} · {owner.email} ({owner.role}{owner.eligible ? '' : ', unavailable'})</option>)}</select></label>
        <div className="flex flex-wrap items-end gap-2"><button type="button" disabled={saving || !active || status === 'APPROVED'} onClick={() => updateApproval(true)} className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Approve</button><button type="button" disabled={saving || !active || status === 'REJECTED'} onClick={() => updateApproval(false)} className="rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-40">Reject</button><button type="button" disabled={saving} onClick={() => updateListingStatus(!active)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${active ? 'bg-gray-100 text-gray-700' : 'bg-blue-50 text-blue-700'}`}>{active ? 'Suspend listing' : 'Activate listing'}</button></div>
      </div>
    </section>
  )
}
