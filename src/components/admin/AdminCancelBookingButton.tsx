'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

export default function AdminCancelBookingButton({
  bookingId,
  hotelName,
  paymentStatus,
  className = '',
}: {
  bookingId: string
  hotelName: string
  paymentStatus: string | null
  className?: string
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const requiresRefund = paymentStatus === 'SUCCESS' || paymentStatus === 'REFUNDED'

  async function cancelBooking() {
    const action = requiresRefund ? 'cancel this booking and refund its captured payment' : 'cancel this booking'
    if (!window.confirm(`Confirm that you want to ${action} for ${hotelName}. This cannot be undone.`)) return
    const reason = window.prompt('Administrative cancellation reason:')
    if (reason === null) return
    if (reason.trim().length < 5) {
      toast.error('Enter a reason of at least 5 characters.')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), confirmation: 'CANCEL_BOOKING' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to cancel this booking.')
      toast.success(data.refund ? 'Booking cancelled and refund initiated' : 'Booking cancelled')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to cancel this booking.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={cancelBooking}
      className={`rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {saving ? 'Processing…' : requiresRefund ? 'Cancel & refund' : 'Cancel booking'}
    </button>
  )
}
