import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { getRazorpay } from '@/lib/razorpay'
import { sendBookingConfirmation } from '@/lib/email'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { dateRangeStrings, fullDayStayDates, requestHasCapacity } from '@/lib/booking-inventory'
import { lockRoomInventory } from '@/lib/booking-inventory-db'
import { slotIsPastForBooking, todayInIndia } from '@/lib/booking-time'
import { roomAllowsSlotType } from '@/lib/room-slot-settings'
import { createBookingDateTimes } from '@/lib/booking-datetime'
import { moneyToNumber, rupeesToPaise } from '@/lib/money'
import { recordPaymentEvent } from '@/lib/payments'

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
    'This slot has already started',
    'This stay duration is disabled for this room',
    'Selected slot does not match the booking date',
    'Selected slot type does not match the booking request',
    'Multi-day bookings require a full-day slot',
    'One or more selected dates are no longer available',
    'This time overlaps another booking',
    'Not enough rooms are available for this time',
    'This hotel is not currently accepting bookings',
    'Payment gateway authentication failed',
  ].includes(error.message) || error.message.startsWith('Selected guests require at least')
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.CUSTOMER_ACCESS)
    if (permissionError) return permissionError

    const role = session!.user.role
    const userId = session!.user.id
    const scope = req.nextUrl.searchParams.get('scope')

    const where: Prisma.BookingWhereInput = { customerId: userId }
    if (scope === 'owner' && hasPermission(role, PERMISSIONS.OWNER_BOOKINGS_MANAGE)) {
      delete where.customerId
      where.roomSlot = { room: { hotel: { ownerId: userId } } }
    }
    if (scope === 'all' && hasPermission(role, PERMISSIONS.ADMIN_ACCESS)) {
      delete where.customerId
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

    return NextResponse.json(bookings.map(booking => ({
      ...booking,
      totalAmount: moneyToNumber(booking.totalAmount),
      payment: booking.payment ? {
        ...booking.payment,
        amount: moneyToNumber(booking.payment.amount),
      } : null,
      extensions: booking.extensions.map(extension => ({
        ...extension,
        additionalAmount: moneyToNumber(extension.additionalAmount),
      })),
    })))
  } catch {
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
    const { success } = await rateLimit(`booking:${ip}`, 10, 60 * 60 * 1000)
    if (!success) {
      return NextResponse.json({ error: 'Too many booking attempts.' }, { status: 429 })
    }

    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.BOOKING_CREATE)
    if (permissionError) return permissionError

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
      const slot = await tx.roomSlot.findUnique({ where: { id: slotId }, include: { room: { include: { hotel: true } } } })
      if (!slot) throw new Error('Slot not found')
      if (!slot.room.hotel.isApproved || !slot.room.hotel.isActive || !slot.room.hotel.ownerEnabled) {
        throw new Error('This hotel is not currently accepting bookings')
      }
      await lockRoomInventory(tx, slot.roomId)
      const maxGuestsPerRoom = Math.max(1, Math.min(slot.room.maxOccupancy, 3))
      const requiredRooms = Math.ceil(guestCount / maxGuestsPerRoom)
      if (roomCount < requiredRooms) {
        throw new Error(`Selected guests require at least ${requiredRooms} room${requiredRooms === 1 ? '' : 's'}`)
      }

      const rangeStart = startDate ?? slot.date
      const rangeEnd = endDate ?? rangeStart
      const requestedSlotType = slotType ?? slot.slotType
      const dates = requestedSlotType === 'FULLDAY'
        ? fullDayStayDates(rangeStart, rangeEnd)
        : dateRangeStrings(rangeStart, rangeEnd)
      if (dates.length === 0) throw new Error('Invalid booking date range')
      if (rangeStart < todayInIndia()) throw new Error('Past dates cannot be booked')
      if (slot.date !== rangeStart) throw new Error('Selected slot does not match the booking date')
      if (slotType && slot.slotType !== slotType) throw new Error('Selected slot type does not match the booking request')
      if (!roomAllowsSlotType(slot.room, slot.slotType)) throw new Error('This stay duration is disabled for this room')
      if (slotIsPastForBooking(slot.slotType, slot.date, slot.startTime)) throw new Error('This slot has already started')
      if (dates.length > 1 && (requestedSlotType !== 'FULLDAY' || slot.slotType !== 'FULLDAY')) {
        throw new Error('Multi-day bookings require a full-day slot')
      }

      const activeBookings = await tx.booking.findMany({
        where: { status: { in: ['PENDING', 'CONFIRMED'] }, roomSlot: { roomId: slot.roomId } },
        select: {
          totalHours: true,
          roomCount: true,
          roomSlot: { select: { date: true, slotType: true, startTime: true, endTime: true } },
        },
      })
      if (!requestHasCapacity(activeBookings, {
        dates,
        slotType: slot.slotType,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }, slot.room.inventoryCount, roomCount)) {
        throw new Error('Not enough rooms are available for this time')
      }

      if (dates.length > 1) {
        const availableSlots = await tx.roomSlot.findMany({
          where: {
            roomId: slot.roomId,
            date: { in: dates },
            slotType: 'FULLDAY',
            startTime: slot.startTime,
            endTime: slot.endTime,
          },
        })

        if (availableSlots.length !== dates.length) {
          throw new Error('One or more selected dates are no longer available')
        }
      }

      const { checkIn, checkOut } = createBookingDateTimes({
        startDate: rangeStart,
        endDate: rangeEnd,
        slotType: slot.slotType,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })

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
          customerId: session!.user.id,
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
          amount: rupeesToPaise(booking.totalAmount),
          currency: 'INR',
          receipt: booking.id.slice(-20),
          notes: {
            bookingId: booking.id,
            customerId: session!.user.id,
          },
        })
      } catch (error) {
        console.error('Razorpay order error:', error)
        throw new Error('Payment gateway authentication failed')
      }

      // Create pending payment record
      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount: booking.totalAmount,
          currency: 'INR',
          provider: 'RAZORPAY',
          providerOrderId: order.id,
          status: 'PENDING',
        },
      })

      await recordPaymentEvent(tx, {
        paymentId: payment.id,
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'CUSTOMER',
        actorId: session!.user.id,
        providerEventId: order.id,
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
        amount: rupeesToPaise(result.booking.totalAmount),
        currency: 'INR',
      }, { status: 201 })
    }

    return NextResponse.json({
      bookingId: result.booking.id,
      razorpayOrderId: result.razorpayOrderId,
      amount: rupeesToPaise(result.booking.totalAmount),
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

