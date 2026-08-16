import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { sendPartnerApplicationAdminEmail } from '@/lib/email'
import { normalizePhone } from '@/lib/otp'
import { rateLimit } from '@/lib/rate-limit'

const GST_NUMBER_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const applicationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the hotel owner’s full name.').max(100),
  businessName: z.string().trim().min(2, 'Enter the registered business or hotel name.').max(150),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  phone: z.string().trim().min(10, 'Enter a valid 10-digit mobile number.').max(20),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  gstNumber: z.string().trim().toUpperCase().regex(GST_NUMBER_PATTERN, 'Enter a valid 15-character GST number.'),
  city: z.string().trim().min(2, 'Enter the hotel city.').max(100),
  state: z.string().trim().min(2, 'Enter the hotel state.').max(100),
  propertyCount: z.coerce.number().int().min(1).max(100),
  message: z.string().trim().max(2000).optional(),
  website: z.string().max(0).optional(),
}).strict().superRefine((data, context) => {
  if (!/[A-Z]/.test(data.password) || !/[0-9]/.test(data.password)) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'Password must include an uppercase letter and a number.' })
  }
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const parsed = applicationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({
        error: parsed.error.issues[0]?.message || 'Check the application details and try again.',
        details: parsed.error.flatten().fieldErrors,
      }, { status: 400 })
    }

    const email = parsed.data.email.toLowerCase()
    const phone = normalizePhone(parsed.data.phone)
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      return NextResponse.json({ error: 'Enter a valid Indian mobile number.' }, { status: 400 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'local'
    if (!rateLimit(`partner:${ip}:${email}`, 4, 60 * 60 * 1000).success) {
      return NextResponse.json({ error: 'Too many application attempts. Please try again in an hour.' }, { status: 429 })
    }

    const existingUsers = await prisma.user.findMany({
      where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { phone }] },
      select: { email: true, phone: true, role: true },
    })
    if (existingUsers.some(user => user.role === 'OWNER' || user.role === 'ADMIN')) {
      return NextResponse.json({ error: 'This account already has partner access. Please sign in.' }, { status: 409 })
    }
    if (existingUsers.length > 0 && !existingUsers.some(user => user.email.toLowerCase() === email && user.phone === phone)) {
      return NextResponse.json({ error: 'That email address or mobile number belongs to another account.' }, { status: 409 })
    }

    const existingApplications = await prisma.partnerApplication.findMany({
      where: { OR: [{ email }, { phone }] },
    })
    if (existingApplications.length > 1 || existingApplications.some(item => item.email !== email || item.phone !== phone)) {
      return NextResponse.json({ error: 'That email address or mobile number is already used by another application.' }, { status: 409 })
    }
    const existingApplication = existingApplications[0]
    if (existingApplication?.status === 'PENDING') {
      return NextResponse.json({ error: 'Your application is already awaiting administrator review.' }, { status: 409 })
    }
    if (existingApplication?.status === 'APPROVED') {
      return NextResponse.json({ error: 'Your partner account is already approved. Please sign in.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const applicationData = {
      fullName: parsed.data.fullName,
      businessName: parsed.data.businessName,
      email,
      phone,
      passwordHash,
      gstNumber: parsed.data.gstNumber,
      city: parsed.data.city,
      state: parsed.data.state,
      propertyCount: parsed.data.propertyCount,
      message: parsed.data.message || null,
    }

    const application = existingApplication
      ? await prisma.partnerApplication.update({
          where: { id: existingApplication.id },
          data: {
            ...applicationData,
            status: 'PENDING',
            reviewedById: null,
            reviewedAt: null,
            reviewReason: null,
          },
        })
      : await prisma.partnerApplication.create({ data: applicationData })

    let notificationSent = true
    try {
      await sendPartnerApplicationAdminEmail(application)
    } catch (error) {
      notificationSent = false
      console.error('Partner application admin email failed:', error)
    }

    return NextResponse.json({
      message: 'Thank you for sharing your details, admin will get back to you soon.',
      applicationId: application.id,
      notificationSent,
    }, { status: 201 })
  } catch (error) {
    console.error('Partner application error:', error)
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'That email address or mobile number is already registered.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'We could not submit your details. Please try again.' }, { status: 500 })
  }
}
