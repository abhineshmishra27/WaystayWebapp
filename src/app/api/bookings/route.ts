import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getRazorpay } from '@/lib/razorpay'
import { sendBookingConfirmation } from '@/lib/email'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const createBookingSchema = z.object({
  slotId: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slotType: z.enum(['H3', 'H6', 'H12', 'FULLDAY']).optional(),
  guestName: z.string().min(2),
  guestEmail: z.string().email(),
  guestPhone: z.string().min(10),
  guestCount: z.number().int().min(1).max(30).default(1),
  roomCount: z.number().int().min(1).max(10).default(1),
  totalAmount: z.number().positive(),
  paymentMethod: z.enum(['RAZORPAY', 'PAY_AT_HOTEL']).default('RAZORPAY'),
})

function dateRange(startDate: string, endDate: string) {
  const dates: string[] = []
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return dates

  for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    dates.push(current.toISOString().split('T')[0])
  }
  return dates
}

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function isRazorpayConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.startsWith('rzp_') &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.startsWith('rzp_')
  )
}

function isBookingConflict(error: Error) {
  return [
    'This slot is no longer available',
    'Invalid booking date range',
    'Past dates cannot be booked',
    'Selected slot does not match the booking date',
    'Multi-day bookings require a full-day slot',
    'One or more selected dates are no longer available',
    'Payment gateway authentication failed',
  ].includes(error.message) || error.message.startsWith('Selected guests require at least')
}

export async function GET(_req: NextRequest) {
  void _req
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const role = session.user.role
    const userId = session.user.id

    const where: Prisma.BookingWhereInput = {}
    if (role === 'CUSTOMER') where.customerId = userId
    if (role === 'OWNER') {
      where.roomSlot = { room: { hotel: { ownerId: userId } } }
    }

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        roomSlot: { include: { room: { include: { hotel: { select: { id: true, name: true, address: true, city: true } } } } } },
        payment: true,
        extensions: true,
        review: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(bookings)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
    const { success } = rateLimit(`booking:${ip}`, 10, 60 * 60 * 1000)
    if (!success) {
      return NextResponse.json({ error: 'Too many booking attempts.' }, { status: 429 })
    }

    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = createBookingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { slotId, guestName, guestEmail, guestPhone, guestCount, roomCount, startDate, endDate, slotType, paymentMethod } = parsed.data
    if (paymentMethod === 'RAZORPAY' && !isRazorpayConfigured()) {
      return NextResponse.json(
        { error: 'Payment gateway credentials are not configured. Please use Pay at Hotel or add Razorpay test keys.' },
        { status: 503 }
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the slot
      const slot = await tx.roomSlot.findUnique({ where: { id: slotId }, include: { room: true } })
      if (!slot) throw new Error('Slot not found')
      if (slot.isBooked) throw new Error('This slot is no longer available')
      const maxGuestsPerRoom = Math.max(1, Math.min(slot.room.maxOccupancy, 3))
      const requiredRooms = Math.ceil(guestCount / maxGuestsPerRoom)
      if (roomCount < requiredRooms) {
        throw new Error(`Selected guests require at least ${requiredRooms} room${requiredRooms === 1 ? '' : 's'}`)
      }

      const rangeStart = startDate ?? slot.date
      const rangeEnd = endDate ?? rangeStart
      const dates = dateRange(rangeStart, rangeEnd)
      if (dates.length === 0) throw new Error('Invalid booking date range')
      if (rangeStart < todayInIndia()) throw new Error('Past dates cannot be booked')
      if (slot.date !== rangeStart) throw new Error('Selected slot does not match the booking date')
      if (dates.length > 1 && (slotType !== 'FULLDAY' || slot.slotType !== 'FULLDAY')) {
        throw new Error('Multi-day bookings require a full-day slot')
      }

      if (dates.length > 1) {
        const availableSlots = await tx.roomSlot.findMany({
          where: {
            roomId: slot.roomId,
            date: { in: dates },
            slotType: 'FULLDAY',
            startTime: slot.startTime,
            isBooked: false,
          },
        })

        if (availableSlots.length !== dates.length) {
          throw new Error('One or more selected dates are no longer available')
        }
      }

      await tx.roomSlot.updateMany({
        where: dates.length > 1
          ? { roomId: slot.roomId, date: { in: dates }, slotType: 'FULLDAY', startTime: slot.startTime }
          : { id: slotId },
        data: { isBooked: true },
      })

      // Calculate check-in/out datetimes
      const [siH, siM] = slot.startTime.split(':').map(Number)
      const [soH, soM] = slot.endTime.split(':').map(Number)
      const checkIn = new Date(`${rangeStart}T00:00:00`)
      checkIn.setHours(siH, siM, 0, 0)
      const checkOut = new Date(`${rangeEnd}T00:00:00`)
      checkOut.setHours(soH, soM, 0, 0)

      const hours: Record<string, number> = { H3: 3, H6: 6, H12: 12, FULLDAY: 24 }
      const totalHours = (hours[slot.slotType] || 3) * dates.length
      const slotPrices = {
        H3: slot.room.price_3h,
        H6: slot.room.price_6h,
        H12: slot.room.price_12h,
        FULLDAY: slot.room.priceFullDay * dates.length,
      }
      const bookingAmount = slotPrices[slot.slotType as keyof typeof slotPrices] * roomCount

      // Create booking
      const booking = await tx.booking.create({
        data: {
          customerId: session.user.id,
          roomSlotId: slotId,
          checkIn,
          checkOut,
          totalHours,
          totalAmount: bookingAmount,
          guestName,
          guestEmail,
          guestPhone,
          guestCount,
          roomCount,
          status: paymentMethod === 'PAY_AT_HOTEL' ? 'CONFIRMED' : 'PENDING',
        },
      })

      if (paymentMethod === 'PAY_AT_HOTEL') {
        return { booking, razorpayOrderId: null }
      }

      // Create Razorpay order
      let order: { id: string }
      try {
        const razorpay = getRazorpay()
        order = await razorpay.orders.create({
          amount: Math.round(booking.totalAmount * 100),
          currency: 'INR',
          receipt: booking.id.slice(-20),
          notes: {
            bookingId: booking.id,
            customerId: session.user.id,
          },
        })
      } catch (error) {
        console.error('Razorpay order error:', error)
        throw new Error('Payment gateway authentication failed')
      }

      // Create pending payment record
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount: booking.totalAmount,
          currency: 'INR',
          provider: 'RAZORPAY',
          providerOrderId: order.id,
          status: 'PENDING',
        },
      })

      return { booking, razorpayOrderId: order.id }
    })

    if (!result.razorpayOrderId) {
      try {
        const booking = await prisma.booking.findUnique({
          where: { id: result.booking.id },
          include: { roomSlot: { include: { room: { include: { hotel: true } } } } },
        })
        if (booking) await sendBookingConfirmation(booking)
      } catch (emailErr) {
        console.error('Email error (non-blocking):', emailErr)
      }

      return NextResponse.json({
        bookingId: result.booking.id,
        paymentMethod: 'PAY_AT_HOTEL',
        amount: Math.round(result.booking.totalAmount * 100),
        currency: 'INR',
      }, { status: 201 })
    }

    return NextResponse.json({
      bookingId: result.booking.id,
      razorpayOrderId: result.razorpayOrderId,
      amount: Math.round(result.booking.totalAmount * 100),
      currency: 'INR',
    }, { status: 201 })
  } catch (err) {
    console.error('Create booking error:', err)
    if (err instanceof Error && isBookingConflict(err)) {
      return NextResponse.json(
        { error: err.message },
        { status: err.message === 'Payment gateway authentication failed' ? 503 : 409 }
      )
    }
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}

