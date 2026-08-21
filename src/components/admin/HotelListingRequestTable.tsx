'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'

type RequestStatus = 'PENDING' | 'REVIEWED' | 'REJECTED'

export interface HotelListingRequestRow {
  id: string
  hotelName: string
  gstNumber: string
  licenseNumber: string | null
  address: string
  city: string
  state: string
  pincode: string
  contactPhone: string
  roomCount: number | null
  message: string | null
  status: RequestStatus
  reviewReason: string | null
  reviewedAt: string | null
  reviewer: { name: string; email: string } | null
  owner: { id: string; name: string; email: string }
  createdAt: string
}

export default function HotelListingRequestTable({ initialRequests }: { initialRequests: HotelListingRequestRow[] }) {
  const [requests, setRequests] = useState(initialRequests)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | RequestStatus>('PENDING')
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return requests.filter(request => {
      const matchesStatus = status === 'ALL' || request.status === status
      const matchesQuery = !needle || [request.hotelName, request.gstNumber, request.city, request.state, request.owner.name, request.owner.email, request.contactPhone]
        .some(value => value.toLowerCase().includes(needle))
      return matchesStatus && matchesQuery
    })
  }, [query, requests, status])

  async function decide(request: HotelListingRequestRow, action: 'REVIEW' | 'REJECT') {
    const reviewing = action === 'REVIEW'
    if (reviewing && !window.confirm(`Mark ${request.hotelName} as reviewed? The hotel must still be created and verified by an administrator.`)) return
    const reason = window.prompt(reviewing
      ? 'Enter a review note (at least 5 characters):'
      : 'Enter the rejection reason that will be emailed to the owner:')
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSavingId(request.id)
    try {
      const response = await fetch(`/api/admin/hotel-listing-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: reason.trim(),
          ...(reviewing ? { confirmation: 'CONFIRM_HOTEL_REQUEST_REVIEW' } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this hotel request.')
      const nextStatus: RequestStatus = reviewing ? 'REVIEWED' : 'REJECTED'
      setRequests(current => current.map(item => item.id === request.id
        ? { ...item, status: nextStatus, reviewReason: reason.trim(), reviewedAt: new Date().toISOString() }
        : item))
      toast.success(reviewing ? 'Hotel request marked as reviewed' : 'Hotel request rejected')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this hotel request.')
    } finally {
      setSavingId(null)
    }
  }

  const statusClass = (value: RequestStatus) => value === 'REVIEWED'
    ? 'bg-green-50 text-green-700'
    : value === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search hotel, owner, city, GST or phone" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <select value={status} onChange={event => setStatus(event.target.value as 'ALL' | RequestStatus)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="ALL">All requests</option>
          <option value="PENDING">Pending</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="space-y-4">
        {filtered.map(request => (
          <article key={request.id} className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{request.hotelName}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(request.status)}`}>{request.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{request.owner.name} · {request.city}, {request.state}</p>
                <p className="mt-1 text-xs text-gray-400">Submitted {new Date(request.createdAt).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {request.status === 'PENDING' && <><button disabled={savingId === request.id} onClick={() => decide(request, 'REJECT')} className="rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Reject</button><button disabled={savingId === request.id} onClick={() => decide(request, 'REVIEW')} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Mark reviewed</button></>}
                {request.status === 'REVIEWED' && <Link href="/admin/hotels/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700">Create hotel</Link>}
              </div>
            </div>
            <dl className="mt-5 grid gap-4 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Owner email</dt><dd className="mt-1 break-all text-gray-800">{request.owner.email}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Contact mobile</dt><dd className="mt-1 text-gray-800">{request.contactPhone}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">GST number</dt><dd className="mt-1 font-mono text-gray-800">{request.gstNumber}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Rooms</dt><dd className="mt-1 text-gray-800">{request.roomCount ?? 'Not provided'}</dd></div>
              <div className="sm:col-span-2 xl:col-span-4"><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Address</dt><dd className="mt-1 text-gray-800">{request.address}, {request.city}, {request.state} {request.pincode}</dd></div>
              {request.licenseNumber && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Licence number</dt><dd className="mt-1 text-gray-800">{request.licenseNumber}</dd></div>}
            </dl>
            {request.message && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Owner note</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{request.message}</p></div>}
            {request.reviewReason && <p className="mt-4 rounded-lg border border-gray-100 p-3 text-xs text-gray-600"><strong>Admin decision:</strong> {request.reviewReason}{request.reviewer ? ` · ${request.reviewer.name}` : ''}{request.reviewedAt ? ` · ${new Date(request.reviewedAt).toLocaleString('en-IN')}` : ''}</p>}
          </article>
        ))}
        {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No additional hotel requests match these filters.</div>}
      </div>
    </div>
  )
}
