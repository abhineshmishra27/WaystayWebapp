'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Toaster } from 'react-hot-toast'
import AdminCancelBookingButton from '@/components/admin/AdminCancelBookingButton'
import { canCancelBooking } from '@/lib/booking-cancellation'

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'

type ManagedBooking = {
  id: string
  status: BookingStatus
  totalAmount: number
  checkIn: string
  checkOut: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount: number
  roomCount: number
  createdAt: string
  customer: { id: string; name: string; email: string }
  hotel: { id: string; name: string; city: string }
  room: { name: string }
  slot: { type: string; date: string; startTime: string; endTime: string }
  payment: { status: string; provider: string; amount: number } | null
}

const statusClasses: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-blue-50 text-blue-700',
}

function paymentLabel(payment: ManagedBooking['payment']) {
  if (!payment) return 'Pay at hotel'
  if (payment.status === 'SUCCESS') return 'Paid online'
  if (payment.status === 'REFUNDED') return 'Refunded'
  if (payment.status === 'REFUND_PENDING') return 'Refund pending'
  return `${payment.provider} · ${payment.status}`
}

export default function BookingManagementTable({ initialBookings }: { initialBookings: ManagedBooking[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | BookingStatus>('ALL')
  const [payment, setPayment] = useState('ALL')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return initialBookings.filter(booking => {
      const matchesQuery = !needle || [
        booking.id, booking.guestName, booking.guestEmail, booking.guestPhone,
        booking.customer.name, booking.customer.email, booking.hotel.name, booking.hotel.city,
      ].some(value => value.toLowerCase().includes(needle))
      const matchesStatus = status === 'ALL' || booking.status === status
      const paymentState = booking.payment?.status ?? 'PAY_AT_HOTEL'
      return matchesQuery && matchesStatus && (payment === 'ALL' || paymentState === payment)
    })
  }, [initialBookings, payment, query, status])

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 lg:flex-row">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search booking ID, guest, email, mobile, hotel or city" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <select value={status} onChange={event => setStatus(event.target.value as 'ALL' | BookingStatus)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="ALL">All booking statuses</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
        </select>
        <select value={payment} onChange={event => setPayment(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="ALL">All payment states</option><option value="PAY_AT_HOTEL">Pay at hotel</option><option value="PENDING">Payment pending</option><option value="SUCCESS">Paid online</option><option value="REFUND_PENDING">Refund pending</option><option value="REFUNDED">Refunded</option><option value="FAILED">Failed</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
        <table className="w-full min-w-[1120px]">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-4 text-left">Booking</th><th className="p-4 text-left">Guest / customer</th><th className="p-4 text-left">Stay</th><th className="p-4 text-left">Payment</th><th className="p-4 text-left">Status</th><th className="p-4 text-left">Actions</th></tr></thead>
          <tbody>
            {filtered.map(booking => {
              const cancellationAllowed = canCancelBooking(booking)
              return (
                <tr key={booking.id} className="border-t border-gray-100 align-top">
                  <td className="p-4"><Link href={`/admin/bookings/${booking.id}`} className="font-mono text-xs font-semibold text-indigo-600 hover:underline">{booking.id}</Link><p className="mt-1 text-xs text-gray-400">Created {new Date(booking.createdAt).toLocaleString('en-IN')}</p></td>
                  <td className="p-4"><p className="text-sm font-medium text-gray-900">{booking.guestName}</p><p className="text-xs text-gray-500">{booking.guestEmail} · {booking.guestPhone}</p><Link href={`/admin/users/${booking.customer.id}`} className="mt-1 inline-block text-xs text-indigo-600 hover:underline">Account: {booking.customer.name}</Link></td>
                  <td className="p-4"><Link href={`/admin/hotels/${booking.hotel.id}`} className="text-sm font-medium text-gray-900 hover:text-indigo-600">{booking.hotel.name}</Link><p className="text-xs text-gray-500">{booking.hotel.city} · {booking.room.name}</p><p className="mt-1 text-xs text-gray-500">{new Date(booking.checkIn).toLocaleString('en-IN')} – {new Date(booking.checkOut).toLocaleString('en-IN')}</p><p className="text-xs text-gray-400">{booking.guestCount} guests · {booking.roomCount} rooms · {booking.slot.type}</p></td>
                  <td className="p-4"><p className="text-sm font-semibold text-gray-900">₹{booking.totalAmount.toLocaleString('en-IN')}</p><p className="mt-1 text-xs text-gray-500">{paymentLabel(booking.payment)}</p></td>
                  <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[booking.status]}`}>{booking.status}</span></td>
                  <td className="p-4"><div className="flex flex-wrap gap-2"><Link href={`/admin/bookings/${booking.id}`} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">View details</Link>{cancellationAllowed ? <AdminCancelBookingButton bookingId={booking.id} hotelName={booking.hotel.name} paymentStatus={booking.payment?.status ?? null} /> : ['PENDING', 'CONFIRMED'].includes(booking.status) ? <span className="self-center text-xs font-medium text-gray-400">Cancellation closed</span> : null}</div></td>
                </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-sm text-gray-500">No bookings match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
