'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast, { Toaster } from 'react-hot-toast'

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayOptions {
  key?: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  handler: (response: RazorpayResponse) => Promise<void>
  prefill: { name: string; email: string; contact: string }
  theme: { color: string }
  modal: { ondismiss: () => void }
}

interface RazorpayInstance {
  open: () => void
}

declare global { interface Window { Razorpay: new (options: RazorpayOptions) => RazorpayInstance } }

const schema = z.object({
  guestName: z.string().min(2, 'Name required'),
  guestEmail: z.string().email('Valid email required'),
  guestPhone: z.string().min(10, 'Valid phone required'),
})
type FormData = z.infer<typeof schema>

const SLOT_LABELS: Record<string, string> = { H3: '3 Hours', H6: '6 Hours', H12: '12 Hours', FULLDAY: 'Full Day' }

export default function BookingPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const queryParams = useMemo(
    () => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''),
    []
  )

  const slotId = queryParams.get('slotId') ?? ''
  const startDate = queryParams.get('startDate') ?? queryParams.get('date') ?? ''
  const endDate = queryParams.get('endDate') ?? startDate
  const startTime = queryParams.get('startTime') ?? ''
  const endTime = queryParams.get('endTime') ?? ''
  const slotType = queryParams.get('slotType') ?? ''
  const price = parseFloat(queryParams.get('price') || '0')

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      guestName: session?.user?.name || '',
      guestEmail: session?.user?.email || '',
    },
  })

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, startDate, endDate, slotType, totalAmount: price, ...data }),
      })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error || 'Failed to create booking')
        setLoading(false)
        return
      }

      const { bookingId, razorpayOrderId, amount } = json

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount,
        currency: 'INR',
        name: 'WayStayy',
        description: `${SLOT_LABELS[slotType] || 'Stay'} stay`,
        order_id: razorpayOrderId,
        handler: async (response: RazorpayResponse) => {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
              bookingId,
            }),
          })
          if (verifyRes.ok) {
            router.push('/booking/success?bookingId=' + bookingId)
          } else {
            toast.error('Payment verification failed. Contact support.')
            setLoading(false)
          }
        },
        prefill: { name: data.guestName, email: data.guestEmail, contact: data.guestPhone },
        theme: { color: '#4f46e5' },
        modal: { ondismiss: () => { setLoading(false) } },
      }
      new window.Razorpay(options).open()
    } catch {
      toast.error('Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-3xl mx-auto px-4 py-12 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 h-fit">
          <h2 className="font-semibold text-gray-900 mb-4">Booking summary</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Start date</span><span className="font-medium">{startDate}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">End date</span><span className="font-medium">{endDate}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Duration</span><span className="font-medium">{SLOT_LABELS[slotType] || 'Custom'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time</span><span className="font-medium">{startTime} – {endTime}</span></div>
            <div className="border-t border-gray-100 pt-3 flex justify-between text-base">
              <span className="font-semibold">Total</span>
              <span className="font-bold text-indigo-600">₹{price}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Guest details</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {[
              { name: 'guestName', label: 'Full name', type: 'text' },
              { name: 'guestEmail', label: 'Email', type: 'email' },
              { name: 'guestPhone', label: 'Phone', type: 'tel' },
            ].map(f => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                <input
                  type={f.type}
                  {...register(f.name as keyof FormData)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {errors[f.name as keyof FormData] && (
                  <p className="text-red-500 text-xs mt-1">{errors[f.name as keyof FormData]?.message}</p>
                )}
              </div>
            ))}
            <p className="text-xs text-gray-400">Booking confirmation will be sent to this email.</p>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Processing...' : `Pay ₹${price}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
