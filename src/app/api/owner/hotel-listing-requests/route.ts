import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { prisma } from '@/lib/db'
import { sendHotelListingRequestAdminEmail } from '@/lib/email'
import { normalizePhone } from '@/lib/otp'
import { rateLimit } from '@/lib/rate-limit'
import { PERMISSIONS } from '@/lib/rbac'

const GST_NUMBER_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const requestSchema = z.object({
  hotelName: z.string().trim().min(2, 'Enter the hotel name.').max(150),
  gstNumber: z.string().trim().toUpperCase().regex(GST_NUMBER_PATTERN, 'Enter a valid 15-character GST number.'),
  licenseNumber: z.string().trim().max(100).optional(),
  address: z.string().trim().min(10, 'Enter the complete hotel address.').max(300),
  city: z.string().trim().min(2, 'Enter the hotel city.').max(100),
  state: z.string().trim().min(2, 'Enter the state.').max(100),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code.'),
  contactPhone: z.string().trim().min(10, 'Enter a valid 10-digit mobile number.').max(20),
  roomCount: z.union([z.coerce.number().int().min(1).max(10000), z.literal('')]).optional(),
  message: z.string().trim().max(2000).optional(),
  website: z.string().max(0).optional(),
}).strict()

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.OWNER_ACCESS)
  if (permissionError) return permissionError

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return NextResponse.json({
      error: firstIssue?.code === 'invalid_type'
        ? 'Complete all required hotel details.'
        : firstIssue?.message || 'Check the hotel details and try again.',
      details: parsed.error.flatten().fieldErrors,
    }, { status: 400 })
  }

  const contactPhone = normalizePhone(parsed.data.contactPhone)
  if (!/^[6-9][0-9]{9}$/.test(contactPhone)) {
    return NextResponse.json({ error: 'Enter a valid Indian mobile number.' }, { status: 400 })
  }

  if (!rateLimit(`hotel-listing-request:${session!.user.id}`, 6, 60 * 60 * 1000).success) {
    return NextResponse.json({ error: 'Too many listing requests. Please try again in an hour.' }, { status: 429 })
  }

  try {
    const duplicate = await prisma.hotelListingRequest.findFirst({
      where: {
        ownerId: session!.user.id,
        status: 'PENDING',
        hotelName: { equals: parsed.data.hotelName, mode: 'insensitive' },
        city: { equals: parsed.data.city, mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: 'A request for this hotel is already awaiting administrator review.' }, { status: 409 })
    }

    const listingRequest = await prisma.hotelListingRequest.create({
      data: {
        ownerId: session!.user.id,
        hotelName: parsed.data.hotelName,
        gstNumber: parsed.data.gstNumber,
        licenseNumber: parsed.data.licenseNumber || null,
        address: parsed.data.address,
        city: parsed.data.city,
        state: parsed.data.state,
        pincode: parsed.data.pincode,
        contactPhone,
        roomCount: parsed.data.roomCount === '' ? null : parsed.data.roomCount,
        message: parsed.data.message || null,
      },
      include: { owner: { select: { name: true, email: true } } },
    })

    let notificationSent = true
    try {
      await sendHotelListingRequestAdminEmail(listingRequest)
    } catch (error) {
      notificationSent = false
      console.error('Additional hotel listing email failed:', error)
    }

    return NextResponse.json({
      message: 'Your hotel listing request has been sent to the Waystay administrator.',
      requestId: listingRequest.id,
      notificationSent,
    }, { status: 201 })
  } catch (error) {
    console.error('Hotel listing request error:', error)
    return NextResponse.json({ error: 'We could not submit this hotel. Please try again.' }, { status: 500 })
  }
}
