'use client'

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type OwnerOption = {
  id: string
  name: string
  email: string
  role: 'CUSTOMER' | 'OWNER' | 'ADMIN'
  eligible: boolean
}
type ManagedHotel = {
  id: string
  name: string
  city: string
  state: string
  address: string
  lat: number
  lng: number
  rating: number
  price3h: number | null
  image: string | null
  owner: { id: string; name: string; email: string }
  approvalStatus: ApprovalStatus
  isActive: boolean
  ownerEnabled: boolean
  createdAt: string
  counts: { rooms: number; reviews: number; photos: number }
}

export default function HotelManagementTable({
  initialHotels,
  ownerOptions,
}: {
  initialHotels: ManagedHotel[]
  ownerOptions: OwnerOption[]
}) {
  const [hotels, setHotels] = useState(initialHotels)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | ApprovalStatus>('ALL')
  const [listingStatus, setListingStatus] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL')
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return hotels.filter(hotel => {
      const matchesStatus = status === 'ALL' || hotel.approvalStatus === status
      const matchesListingStatus = listingStatus === 'ALL' || (listingStatus === 'ACTIVE' ? hotel.isActive : !hotel.isActive)
      const matchesQuery = !needle || [hotel.name, hotel.city, hotel.state, hotel.owner.name, hotel.owner.email]
        .some(value => value.toLowerCase().includes(needle))
      return matchesStatus && matchesListingStatus && matchesQuery
    })
  }, [hotels, listingStatus, query, status])

  async function assignOwner(hotel: ManagedHotel, ownerId: string) {
    if (ownerId === hotel.owner.id) return
    const nextOwner = ownerOptions.find(owner => owner.id === ownerId)
    if (!nextOwner?.eligible || !window.confirm(`Assign ${hotel.name} to ${nextOwner.name} (${nextOwner.email})?`)) return
    const reason = window.prompt(`Reason for transferring ${hotel.name} to ${nextOwner.name}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSavingId(hotel.id)
    try {
      const response = await fetch(`/api/admin/hotels/${hotel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, reason: reason.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to assign this owner.')
      setHotels(current => current.map(item => item.id === hotel.id ? { ...item, owner: data.hotel.owner } : item))
      toast.success('Hotel owner updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to assign this owner.')
    } finally {
      setSavingId(null)
    }
  }

  async function updateApproval(hotel: ManagedHotel, approved: boolean) {
    let reason: string | undefined
    if (approved) {
      if (!window.confirm(`Approve ${hotel.name} and make it visible for booking?`)) return
    } else {
      const response = window.prompt(`Why is ${hotel.name} being rejected? This reason may be emailed to the owner.`)
      if (response === null) return
      reason = response.trim()
      if (reason.length < 5) return toast.error('Enter a clear rejection reason of at least 5 characters.')
    }

    setSavingId(hotel.id)
    try {
      const response = await fetch(`/api/admin/hotels/${hotel.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update hotel approval.')
      setHotels(current => current.map(item => item.id === hotel.id
        ? { ...item, approvalStatus: approved ? 'APPROVED' : 'REJECTED' }
        : item))
      toast.success(approved ? 'Hotel approved' : 'Hotel rejected')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update hotel approval.')
    } finally {
      setSavingId(null)
    }
  }

  async function updateListingStatus(hotel: ManagedHotel, isActive: boolean) {
    const action = isActive ? 'activate' : 'suspend'
    if (!window.confirm(`Confirm that you want to ${action} ${hotel.name}.`)) return
    const reason = window.prompt(`Reason to ${action} ${hotel.name}:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')
    setSavingId(hotel.id)
    try {
      const response = await fetch(`/api/admin/hotels/${hotel.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive, reason: reason.trim() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update listing status.')
      setHotels(current => current.map(item => item.id === hotel.id ? { ...item, isActive } : item))
      toast.success(isActive ? 'Hotel activated' : 'Hotel suspended')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update listing status.')
    } finally {
      setSavingId(null)
    }
  }

  const statusClass = (value: ApprovalStatus) => value === 'APPROVED'
    ? 'bg-green-50 text-green-700'
    : value === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search hotel, city, or owner" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <select value={status} onChange={event => setStatus(event.target.value as 'ALL' | ApprovalStatus)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="ALL">All approval states</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
        </select>
        <select value={listingStatus} onChange={event => setListingStatus(event.target.value as 'ALL' | 'ACTIVE' | 'SUSPENDED')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"><option value="ALL">All listing statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
        <table className="w-full min-w-[1050px]">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-4 text-left">Hotel</th><th className="p-4 text-left">Owner</th><th className="p-4 text-left">Property</th><th className="p-4 text-left">Approval</th><th className="p-4 text-left">Actions</th></tr></thead>
          <tbody>
            {filtered.map(hotel => (
              <tr key={hotel.id} className="border-t border-gray-100 align-middle">
                <td className="p-4"><div className="flex items-center gap-3">{hotel.image ? <img src={hotel.image} alt="" className="h-12 w-16 rounded-lg object-cover" /> : <div className="flex h-12 w-16 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">No photo</div>}<div><p className="text-sm font-medium text-gray-900">{hotel.name}</p><p className="text-xs text-gray-500">{hotel.address}, {hotel.city}, {hotel.state}</p><p className="text-xs text-gray-400">{hotel.lat.toFixed(5)}, {hotel.lng.toFixed(5)} · Submitted {new Date(hotel.createdAt).toLocaleDateString('en-IN')}</p></div></div></td>
                <td className="p-4"><select aria-label={`Owner for ${hotel.name}`} value={hotel.owner.id} disabled={savingId === hotel.id} onChange={event => assignOwner(hotel, event.target.value)} className="max-w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs disabled:bg-gray-50">{ownerOptions.map(owner => <option key={owner.id} value={owner.id} disabled={!owner.eligible}>{owner.name} · {owner.email} ({owner.role}{owner.eligible ? '' : ', unavailable'})</option>)}</select></td>
                <td className="p-4 text-xs text-gray-500"><span className="font-semibold text-amber-600">★ {hotel.rating.toFixed(1)}</span> · {hotel.counts.rooms} rooms · {hotel.counts.reviews} reviews<br />{hotel.counts.photos} photos · {hotel.price3h ? `From ₹${hotel.price3h}/3h` : 'No room pricing'}<br /><span className={hotel.isActive ? 'text-green-700' : 'text-red-700'}>{hotel.isActive ? 'Active listing' : 'Suspended listing'}</span> · <span className={hotel.ownerEnabled ? 'text-green-700' : 'text-amber-700'}>{hotel.ownerEnabled ? 'Owner enabled' : 'Owner disabled'}</span></td>
                <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(hotel.approvalStatus)}`}>{hotel.approvalStatus}</span></td>
                <td className="p-4"><div className="flex flex-wrap items-center gap-2"><Link href={`/admin/hotels/${hotel.id}`} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Review</Link><button disabled={savingId === hotel.id || !hotel.isActive || hotel.approvalStatus === 'APPROVED'} onClick={() => updateApproval(hotel, true)} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve</button><button disabled={savingId === hotel.id || !hotel.isActive || hotel.approvalStatus === 'REJECTED'} onClick={() => updateApproval(hotel, false)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40">Reject</button><button disabled={savingId === hotel.id} onClick={() => updateListingStatus(hotel, !hotel.isActive)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${hotel.isActive ? 'bg-gray-100 text-gray-700' : 'bg-blue-50 text-blue-700'}`}>{hotel.isActive ? 'Suspend' : 'Activate'}</button></div></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-sm text-gray-500">No hotels match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
