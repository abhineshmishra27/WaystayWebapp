'use client'

import { useMemo, useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'

type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface PartnerApplicationRow {
  id: string
  fullName: string
  businessName: string
  email: string
  phone: string
  gstNumber: string
  city: string
  state: string
  propertyCount: number
  message: string | null
  status: ApplicationStatus
  reviewReason: string | null
  reviewedAt: string | null
  reviewer: { name: string; email: string } | null
  createdAt: string
}

export default function PartnerApplicationTable({ initialApplications }: { initialApplications: PartnerApplicationRow[] }) {
  const [applications, setApplications] = useState(initialApplications)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | ApplicationStatus>('PENDING')
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return applications.filter(application => {
      const matchesStatus = status === 'ALL' || application.status === status
      const matchesQuery = !needle || [application.fullName, application.businessName, application.email, application.phone, application.gstNumber, application.city, application.state]
        .some(value => value.toLowerCase().includes(needle))
      return matchesStatus && matchesQuery
    })
  }, [applications, query, status])

  async function decide(application: PartnerApplicationRow, action: 'APPROVE' | 'REJECT') {
    const approving = action === 'APPROVE'
    if (approving && !window.confirm(`Approve ${application.fullName} as a hotel owner? This will create or activate an OWNER account.`)) return
    const reason = window.prompt(approving
      ? 'Enter an internal approval note (at least 5 characters):'
      : 'Enter the rejection reason that will be emailed to the applicant:')
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSavingId(application.id)
    try {
      const response = await fetch(`/api/admin/partner-applications/${application.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: reason.trim(),
          ...(approving ? { confirmation: 'APPROVE_OWNER_ACCOUNT' } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this application.')
      const nextStatus: ApplicationStatus = approving ? 'APPROVED' : 'REJECTED'
      setApplications(current => current.map(item => item.id === application.id
        ? { ...item, status: nextStatus, reviewReason: reason.trim(), reviewedAt: new Date().toISOString() }
        : item))
      toast.success(approving ? 'Owner account approved' : 'Application rejected')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this application.')
    } finally {
      setSavingId(null)
    }
  }

  const statusClass = (value: ApplicationStatus) => value === 'APPROVED'
    ? 'bg-green-50 text-green-700'
    : value === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search owner, business, GST, email or phone" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <select value={status} onChange={event => setStatus(event.target.value as 'ALL' | ApplicationStatus)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="ALL">All applications</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="space-y-4">
        {filtered.map(application => (
          <article key={application.id} className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-900">{application.businessName}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(application.status)}`}>{application.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{application.fullName} · {application.city}, {application.state}</p>
                <p className="mt-1 text-xs text-gray-400">Submitted {new Date(application.createdAt).toLocaleString('en-IN')}</p>
              </div>
              {application.status === 'PENDING' && <div className="flex gap-2"><button disabled={savingId === application.id} onClick={() => decide(application, 'REJECT')} className="rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Reject</button><button disabled={savingId === application.id} onClick={() => decide(application, 'APPROVE')} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve owner</button></div>}
            </div>
            <dl className="mt-5 grid gap-4 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Email</dt><dd className="mt-1 text-gray-800">{application.email}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Mobile</dt><dd className="mt-1 text-gray-800">{application.phone}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">GST number</dt><dd className="mt-1 font-mono text-gray-800">{application.gstNumber}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Properties</dt><dd className="mt-1 text-gray-800">{application.propertyCount}</dd></div>
            </dl>
            {application.message && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Applicant note</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{application.message}</p></div>}
            {application.reviewReason && <p className="mt-4 rounded-lg border border-gray-100 p-3 text-xs text-gray-600"><strong>Admin decision:</strong> {application.reviewReason}{application.reviewer ? ` · ${application.reviewer.name}` : ''}{application.reviewedAt ? ` · ${new Date(application.reviewedAt).toLocaleString('en-IN')}` : ''}</p>}
          </article>
        ))}
        {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No partner applications match these filters.</div>}
      </div>
    </div>
  )
}
