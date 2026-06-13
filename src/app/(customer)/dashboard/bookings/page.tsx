'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-50 text-gray-500',
  COMPLETED: 'bg-blue-50 text-blue-700',
}

interface BookingSummary {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  totalAmount: number
  createdAt: string
  review: { id: string } | null
  roomSlot: {
    date: string
    startTime: string
    endTime: string
    slotType: string
    room: { name: string; hotel: { id: string; name: string; city: string } }
  }
  payment: { status: string; provider: string } | null
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<BookingSummary[]>([])
  const [tab, setTab] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/bookings').then(r => r.json()).then(data => {
      setBookings(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  const handleCancel = async (bookingId: string) => {
    if (!confirm('Cancel this booking?')) return
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, { method: 'PATCH' })
    if (res.ok) {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'CANCELLED' } : b))
      toast.success('Booking cancelled')
    } else {
      toast.error('Failed to cancel booking')
    }
  }

  const filtered = bookings.filter((b) => {
    if (tab === 'upcoming') return ['PENDING', 'CONFIRMED'].includes(b.status)
    if (tab === 'past') return ['COMPLETED', 'CANCELLED'].includes(b.status)
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">My bookings</h1>
          <Link href="/hotels" className="text-sm text-indigo-600 hover:underline">Find a hotel</Link>
        </div>

        <div className="flex gap-2 mb-6">
          {(['upcoming', 'past', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
              {t}
            </button>
          ))}
        </div>

        {loading ? <p className="text-gray-400">Loading bookings...</p> : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 mb-4">No {tab} bookings</p>
            <Link href="/hotels" className="text-indigo-600 hover:underline text-sm">Browse hotels →</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(b => {
              const hotel = b.roomSlot?.room?.hotel
              const slot = b.roomSlot
              const paymentLabel = b.payment
                ? b.payment.status === 'SUCCESS' ? 'Paid online' : `Payment ${b.payment.status.toLowerCase()}`
                : 'Pay at hotel'
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-gray-100 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">{hotel?.name}</h3>
                      <p className="text-sm text-gray-500">{hotel?.city} · {slot?.room?.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[b.status]}`}>{b.status}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                    <div><p className="text-gray-400 text-xs">Date</p><p className="font-medium">{slot?.date}</p></div>
                    <div><p className="text-gray-400 text-xs">Time</p><p className="font-medium">{slot?.startTime} – {slot?.endTime}</p></div>
                    <div><p className="text-gray-400 text-xs">Amount</p><p className="font-medium text-indigo-600">₹{b.totalAmount}</p></div>
                  </div>
                  <div className="mb-4">
                    <span className="inline-flex text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">{paymentLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-300 font-mono">{b.id}</p>
                    <div className="flex gap-2">
                      {b.status === 'COMPLETED' && !b.review && (
                        <Link href={`/dashboard/bookings/${b.id}/review`}
                          className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-100 font-medium">Write a review</Link>
                      )}
                      {['PENDING', 'CONFIRMED'].includes(b.status) && (
                        <button onClick={() => handleCancel(b.id)}
                          className="text-xs text-red-500 border border-red-100 px-3 py-1.5 rounded-lg hover:bg-red-50">Cancel</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
