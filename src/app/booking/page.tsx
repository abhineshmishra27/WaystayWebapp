'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast, { Toaster } from 'react-hot-toast'

const schema = z.object({
  guestName: z.string().min(2, 'Name required'),
  guestEmail: z.string().email('Valid email required'),
  guestPhone: z.string().min(10, 'Valid phone required'),
})

type FormData = z.infer<typeof schema>

const SLOT_LABELS: Record<string, string> = {
  H3: '3 Hours',
  H6: '6 Hours',
  H12: '12 Hours',
  FULLDAY: 'Full Day',
}

function positiveInt(value: string | null, fallback: number) {
  const parsed = parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function BookingPreview() {
  const { data: session } = useSession()
  const router = useRouter()
  const queryParams = useSearchParams()

  const slotId = queryParams.get('slotId') ?? ''
  const roomId = queryParams.get('roomId') ?? ''
  const hotelId = queryParams.get('hotelId') ?? ''
  const startDate = queryParams.get('startDate') ?? queryParams.get('date') ?? ''
  const endDate = queryParams.get('endDate') ?? startDate
  const startTime = queryParams.get('startTime') ?? ''
  const endTime = queryParams.get('endTime') ?? ''
  const slotType = queryParams.get('slotType') ?? ''
  const price = parseFloat(queryParams.get('price') || '0')
  const guestCount = positiveInt(queryParams.get('guestCount'), 1)
  const roomCount = positiveInt(queryParams.get('roomCount'), 1)
  const maxGuestsPerRoom = positiveInt(queryParams.get('maxGuestsPerRoom'), 3)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      guestName: session?.user?.name || '',
      guestEmail: session?.user?.email || '',
    },
  })

  useEffect(() => {
    if (session?.user?.name) setValue('guestName', session.user.name)
    if (session?.user?.email) setValue('guestEmail', session.user.email)
  }, [session, setValue])

  useEffect(() => {
    if (!session) return

    let cancelled = false

    async function fetchProfilePhone() {
      try {
        const res = await fetch('/api/profile')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.user?.phone) {
          setValue('guestPhone', data.user.phone)
        }
      } catch {
        // Leave the phone field editable if profile details cannot be loaded.
      }
    }

    fetchProfilePhone()

    return () => {
      cancelled = true
    }
  }, [session, setValue])

  const isMissingBooking = !slotId || !roomId || !hotelId || !startDate || !slotType || !price

  const onSubmit = (data: FormData) => {
    if (isMissingBooking) {
      toast.error('Please select a room slot again.')
      return
    }

    const paymentParams = new URLSearchParams({
      slotId,
      roomId,
      hotelId,
      startDate,
      endDate,
      startTime,
      endTime,
      slotType,
      price: price.toString(),
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      guestCount: guestCount.toString(),
      roomCount: roomCount.toString(),
      maxGuestsPerRoom: maxGuestsPerRoom.toString(),
    })

    router.push(`/payment?${paymentParams.toString()}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-3xl mx-auto px-4 py-12 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 h-fit">
          <h2 className="font-semibold text-gray-900 mb-4">Booking preview</h2>
          {isMissingBooking ? (
            <p className="text-sm text-gray-500">This booking preview is missing slot details. Please choose a room and slot again.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Start date</span><span className="font-medium">{startDate}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">End date</span><span className="font-medium">{endDate}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Duration</span><span className="font-medium">{SLOT_LABELS[slotType] || 'Custom'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Time</span><span className="font-medium">{startTime} - {endTime}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Guests</span><span className="font-medium">{guestCount}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Rooms</span><span className="font-medium">{roomCount}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Capacity</span><span className="font-medium">{maxGuestsPerRoom} guests/room</span></div>
              <div className="border-t border-gray-100 pt-3 flex justify-between text-base">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-indigo-600">₹{price}</span>
              </div>
            </div>
          )}
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
            <p className="text-xs text-gray-400">You can review payment details on the next page.</p>
            <button
              type="submit"
              disabled={isMissingBooking}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Confirm booking preview
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function BookingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <BookingPreview />
    </Suspense>
  )
}
