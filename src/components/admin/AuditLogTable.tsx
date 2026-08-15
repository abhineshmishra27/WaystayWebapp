'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type AuditEntry = {
  id: string
  action: string
  targetType: string
  targetId: string
  targetLabel: string
  targetHref: string | null
  adminName: string
  adminEmail: string
  reason: string
  before: string
  after: string
  createdAt: string
}

export default function AuditLogTable({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState('')
  const [targetType, setTargetType] = useState('ALL')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter(entry => {
      const matchesType = targetType === 'ALL' || entry.targetType === targetType
      const matchesQuery = !needle || [entry.action, entry.targetLabel, entry.targetId, entry.adminName, entry.adminEmail, entry.reason].some(value => value.toLowerCase().includes(needle))
      return matchesType && matchesQuery
    })
  }, [entries, query, targetType])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search action, administrator, target or reason" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /><select value={targetType} onChange={event => setTargetType(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"><option value="ALL">All targets</option><option value="User">Users</option><option value="Hotel">Hotels</option><option value="Booking">Bookings</option><option value="Review">Reviews</option></select></div>
      <div className="space-y-3">{filtered.map(entry => <article key={entry.id} className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{entry.action}</span><p className="mt-3 text-sm font-medium text-gray-900">{entry.targetHref ? <Link href={entry.targetHref} className="text-indigo-600 hover:underline">{entry.targetLabel}</Link> : entry.targetLabel}</p><p className="mt-1 text-xs text-gray-500">Administrator: {entry.adminName} ({entry.adminEmail})</p></div><time className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString('en-IN')}</time></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-lg bg-red-50/60 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-red-500">Old values</p><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-gray-700">{entry.before}</pre></div><div className="rounded-lg bg-green-50/60 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-green-600">New values</p><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-gray-700">{entry.after}</pre></div></div><div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><span className="font-semibold">Reason:</span> {entry.reason}</div></article>)}{filtered.length === 0 && <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">No administrative changes match these filters.</div>}</div>
    </div>
  )
}
