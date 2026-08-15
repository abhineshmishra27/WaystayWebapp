'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import toast, { Toaster } from 'react-hot-toast'

type ReviewStatus = 'PUBLISHED' | 'HIDDEN'

type ManagedReview = {
  id: string
  status: ReviewStatus
  rating: number
  title: string
  body: string
  ownerReply: string | null
  moderationReason: string | null
  moderatedAt: string | null
  createdAt: string
  customer: { id: string; name: string; email: string }
  hotel: { id: string; name: string; city: string }
  bookingId: string
  media: { id: string; url: string; type: string }[]
}

export default function ReviewModerationList({ initialReviews }: { initialReviews: ManagedReview[] }) {
  const [reviews, setReviews] = useState(initialReviews)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | ReviewStatus>('ALL')
  const [rating, setRating] = useState('ALL')
  const [savingId, setSavingId] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reviews.filter(review => {
      const matchesQuery = !needle || [review.id, review.title, review.body, review.customer.name, review.customer.email, review.hotel.name, review.hotel.city, review.bookingId].some(value => value.toLowerCase().includes(needle))
      return matchesQuery && (status === 'ALL' || review.status === status) && (rating === 'ALL' || review.rating === Number(rating))
    })
  }, [query, rating, reviews, status])

  async function moderate(review: ManagedReview, nextStatus: ReviewStatus) {
    const verb = nextStatus === 'HIDDEN' ? 'hide' : 'republish'
    if (!window.confirm(`Confirm that you want to ${verb} “${review.title}”.`)) return
    const reason = window.prompt(`Reason to ${verb} this review:`)
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')

    setSavingId(review.id)
    try {
      const response = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reason: reason.trim(), confirmation: 'CONFIRM_REVIEW_MODERATION' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to moderate this review.')
      setReviews(current => current.map(item => item.id === review.id ? {
        ...item,
        status: nextStatus,
        moderationReason: reason.trim(),
        moderatedAt: data.review.moderatedAt || new Date().toISOString(),
      } : item))
      toast.success(nextStatus === 'HIDDEN' ? 'Review hidden from public pages' : 'Review published')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to moderate this review.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 lg:flex-row"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search review, customer, hotel or booking ID" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /><select value={status} onChange={event => setStatus(event.target.value as 'ALL' | ReviewStatus)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"><option value="ALL">All visibility states</option><option value="PUBLISHED">Published</option><option value="HIDDEN">Hidden</option></select><select value={rating} onChange={event => setRating(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"><option value="ALL">All ratings</option>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} stars</option>)}</select></div>

      <div className="space-y-4">{filtered.map(review => <article key={review.id} className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${review.status === 'PUBLISHED' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{review.status}</span><span className="text-sm font-semibold text-amber-600">★ {review.rating}/5</span></div><h2 className="mt-3 font-semibold text-gray-900">{review.title}</h2><p className="mt-1 text-xs text-gray-500">By <Link href={`/admin/users/${review.customer.id}`} className="text-indigo-600 hover:underline">{review.customer.name}</Link> ({review.customer.email}) · <Link href={`/admin/hotels/${review.hotel.id}`} className="text-indigo-600 hover:underline">{review.hotel.name}</Link>, {review.hotel.city}</p><p className="mt-1 text-xs text-gray-400">Submitted {new Date(review.createdAt).toLocaleString('en-IN')} · <Link href={`/admin/bookings/${review.bookingId}`} className="font-mono text-indigo-600 hover:underline">Booking {review.bookingId}</Link></p></div><button disabled={savingId === review.id} onClick={() => moderate(review, review.status === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED')} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${review.status === 'PUBLISHED' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>{savingId === review.id ? 'Saving…' : review.status === 'PUBLISHED' ? 'Hide review' : 'Republish review'}</button></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-gray-700">{review.body}</p>{review.media.length > 0 && <div className="mt-4 flex gap-3 overflow-x-auto">{review.media.map(media => media.type === 'IMAGE' ? <Image key={media.id} src={media.url} alt="Review attachment" width={128} height={96} unoptimized className="h-24 w-32 flex-none rounded-lg object-cover" /> : <a key={media.id} href={media.url} target="_blank" rel="noreferrer" className="flex h-24 w-32 flex-none items-center justify-center rounded-lg bg-gray-100 text-xs text-indigo-600">Open video</a>)}</div>}{review.ownerReply && <div className="mt-4 rounded-lg bg-indigo-50 p-3"><p className="text-xs font-semibold text-indigo-700">Hotel response</p><p className="mt-1 text-sm text-gray-700">{review.ownerReply}</p></div>}{review.moderationReason && <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><span className="font-semibold">Latest moderation reason:</span> {review.moderationReason}{review.moderatedAt && <span className="text-xs text-gray-400"> · {new Date(review.moderatedAt).toLocaleString('en-IN')}</span>}</div>}</article>)}{filtered.length === 0 && <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">No reviews match these filters.</div>}</div>
    </div>
  )
}
