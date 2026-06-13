'use client'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  handler: (response: RazorpayResponse) => Promise<void>
  prefill: { name: string; email: string; contact: string }
  notes: Record<string, string>
  theme: { color: string }
  modal: { ondismiss: () => void }
}

interface RazorpayInstance {
  open: () => void
  on: (event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void) => void
}

interface RazorpayFailureResponse {
  error?: {
    description?: string
    metadata?: {
      payment_id?: string
      order_id?: string
    }
  }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

const SLOT_LABELS: Record<string, string> = {
  H3: '3 Hours',
  H6: '6 Hours',
  H12: '12 Hours',
  FULLDAY: 'Full Day',
}

function PaymentDetails() {
  const router = useRouter()
  const queryParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [onlineLoading, setOnlineLoading] = useState(false)
  const [checkoutReady, setCheckoutReady] = useState(() => typeof window !== 'undefined' && Boolean(window.Razorpay))
  const paymentCallbackStarted = useRef(false)

  const slotId = queryParams.get('slotId') ?? ''
  const hotelId = queryParams.get('hotelId') ?? ''
  const startDate = queryParams.get('startDate') ?? ''
  const endDate = queryParams.get('endDate') ?? startDate
  const startTime = queryParams.get('startTime') ?? ''
  const endTime = queryParams.get('endTime') ?? ''
  const slotType = queryParams.get('slotType') ?? ''
  const price = queryParams.get('price') ?? '0'
  const guestName = queryParams.get('guestName') ?? ''
  const guestEmail = queryParams.get('guestEmail') ?? ''
  const guestPhone = queryParams.get('guestPhone') ?? ''
  const isMissingBooking = !slotId || !startDate || !slotType || !price || !guestName || !guestEmail || !guestPhone
  const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const isGatewayConfigured = razorpayKey.startsWith('rzp_')

  const releasePendingBooking = async (
    bookingId: string,
    razorpayOrderId: string,
    razorpayPaymentId?: string
  ) => {
    try {
      await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, razorpayOrderId, razorpayPaymentId }),
      })
    } catch (error) {
      console.error('Unable to release pending booking:', error)
    }
  }

  useEffect(() => {
    if (window.Razorpay) {
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => setCheckoutReady(true)
    script.onerror = () => toast.error('Unable to load Razorpay checkout')
    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  const handlePayAtHotel = async () => {
    if (isMissingBooking) {
      toast.error('Please select a room slot again.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          startDate,
          endDate,
          slotType,
          guestName,
          guestEmail,
          guestPhone,
          totalAmount: Number(price),
          paymentMethod: 'PAY_AT_HOTEL',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to complete booking')
      router.push(`/booking/success?bookingId=${encodeURIComponent(data.bookingId)}&paymentMethod=pay-at-hotel`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete booking')
      setLoading(false)
    }
  }

  const handlePayOnline = async () => {
    if (isMissingBooking) {
      toast.error('Please select a room slot again.')
      return
    }
    if (!isGatewayConfigured) {
      toast.error('Razorpay test keys are not configured. Use Pay at Hotel for now.')
      return
    }
    if (!checkoutReady || !window.Razorpay) {
      toast.error('Payment gateway is still loading. Please try again in a moment.')
      return
    }

    setOnlineLoading(true)
    try {
      const bookingRes = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          startDate,
          endDate,
          slotType,
          guestName,
          guestEmail,
          guestPhone,
          totalAmount: Number(price),
          paymentMethod: 'RAZORPAY',
        }),
      })
      const bookingData = await bookingRes.json()
      if (!bookingRes.ok) throw new Error(bookingData.error || 'Failed to start payment')
      paymentCallbackStarted.current = false

      const checkout = new window.Razorpay({
        key: razorpayKey,
        amount: bookingData.amount,
        currency: bookingData.currency || 'INR',
        name: 'WayStayy',
        description: `${SLOT_LABELS[slotType] || 'Hotel'} booking`,
        order_id: bookingData.razorpayOrderId,
        prefill: {
          name: guestName,
          email: guestEmail,
          contact: guestPhone,
        },
        notes: {
          bookingId: bookingData.bookingId,
          slotId,
          hotelId,
        },
        theme: { color: '#4f46e5' },
        modal: {
          ondismiss: () => {
            if (!paymentCallbackStarted.current) {
              void releasePendingBooking(bookingData.bookingId, bookingData.razorpayOrderId)
            }
            setOnlineLoading(false)
            if (!paymentCallbackStarted.current) toast.error('Payment was not completed')
          },
        },
        handler: async (response) => {
          paymentCallbackStarted.current = true
          try {
            const verifyRes = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
                bookingId: bookingData.bookingId,
              }),
            })
            const verifyData = await verifyRes.json()
            if (!verifyRes.ok) throw new Error(verifyData.error || 'Payment verification failed')
            router.push(`/booking/success?bookingId=${encodeURIComponent(bookingData.bookingId)}&paymentMethod=online`)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Payment verification failed')
            setOnlineLoading(false)
          }
        },
      })

      checkout.on('payment.failed', (response) => {
        paymentCallbackStarted.current = true
        void releasePendingBooking(
          bookingData.bookingId,
          bookingData.razorpayOrderId,
          response.error?.metadata?.payment_id
        )
        setOnlineLoading(false)
        toast.error(response.error?.description || 'Payment failed. Please try another method.')
      })
      checkout.open()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start payment')
      setOnlineLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="mb-6">
            <p className="text-sm font-medium text-indigo-600">Payment</p>
            <h1 className="text-2xl font-semibold text-gray-900 mt-1">Choose how to pay</h1>
            <p className="text-sm text-gray-500 mt-2">
              Pay securely online or reserve now and pay directly at the hotel.
            </p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Guest</span><span className="font-medium">{guestName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Email</span><span className="font-medium">{guestEmail}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Phone</span><span className="font-medium">{guestPhone}</span></div>
            <div className="border-t border-gray-100 pt-3 flex justify-between"><span className="text-gray-500">Dates</span><span className="font-medium">{startDate} to {endDate}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Duration</span><span className="font-medium">{SLOT_LABELS[slotType] || 'Custom'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time</span><span className="font-medium">{startTime} - {endTime}</span></div>
            <div className="border-t border-gray-100 pt-3 flex justify-between text-base">
              <span className="font-semibold">Amount due</span>
              <span className="font-bold text-indigo-600">₹{price}</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handlePayAtHotel}
              disabled={loading || isMissingBooking}
              className="group w-full rounded-xl border border-indigo-600 bg-indigo-600 px-5 py-4 text-left text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-base font-semibold">{loading ? 'Confirming booking...' : 'Pay at Hotel'}</span>
                  <span className="block text-sm text-indigo-100 mt-1">Reserve now and pay directly at the property.</span>
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">₹{price}</span>
              </span>
            </button>

            <button
              type="button"
              onClick={handlePayOnline}
              disabled={onlineLoading || loading || isMissingBooking || !checkoutReady || !isGatewayConfigured}
              className="w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-base font-semibold text-gray-800">{onlineLoading ? 'Opening secure checkout...' : 'Pay Online'}</span>
                  <span className="block text-sm text-gray-400 mt-1">
                    {isGatewayConfigured ? 'Pay securely using Razorpay checkout.' : 'Add Razorpay test keys to enable online payment.'}
                  </span>
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
                  {isGatewayConfigured ? `₹${price}` : 'Setup needed'}
                </span>
              </span>
            </button>
          </div>

          <div className="mt-6">
            <Link
              href={hotelId ? `/hotels/${hotelId}` : '/hotels'}
              className="block text-center border border-gray-200 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              Back to hotel
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <PaymentDetails />
    </Suspense>
  )
}
