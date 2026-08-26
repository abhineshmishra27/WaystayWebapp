import { NextRequest, NextResponse } from 'next/server'
import { createOtpChallenge, normalizeIdentifier } from '@/lib/otp'
import { deliverOtp } from '@/lib/otp-delivery'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  identifier: z.string().min(3, 'Enter your email or mobile number'),
  purpose: z.enum(['login', 'register']),
  email: z.string().email().optional(),
  phone: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })

  const identifier = normalizeIdentifier(parsed.data.identifier)
  const registrationEmail = parsed.data.email?.trim().toLowerCase()
  const registrationPhone = parsed.data.phone ? normalizeIdentifier(parsed.data.phone) : undefined

  if (parsed.data.purpose === 'register' && (!registrationEmail || !registrationPhone)) {
    return NextResponse.json({ error: 'Email and mobile number are required.' }, { status: 400 })
  }
  if (parsed.data.purpose === 'register' && !/^[6-9]\d{9}$/.test(registrationPhone || '')) {
    return NextResponse.json({ error: 'Enter a valid 10-digit mobile number.' }, { status: 400 })
  }
  if (parsed.data.purpose === 'login' && !identifier.includes('@') && !/^[6-9]\d{9}$/.test(identifier)) {
    return NextResponse.json({ error: 'Enter a valid email or 10-digit mobile number.' }, { status: 400 })
  }
  if (!identifier.includes('@')) {
    return NextResponse.json({ error: 'Mobile OTP must be requested through Firebase.' }, { status: 400 })
  }

  const { prisma } = await import('@/lib/db')
  const user = parsed.data.purpose === 'login'
    ? await prisma.user.findFirst({
        where: { isActive: true, OR: [{ email: identifier }, { phone: identifier }] },
        select: { email: true, phone: true },
      })
    : null
  if (parsed.data.purpose === 'login' && !user) {
    return NextResponse.json({ error: 'No active account matches that email or mobile number.' }, { status: 404 })
  }

  if (parsed.data.purpose === 'register') {
    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: registrationEmail, mode: 'insensitive' } },
          { phone: registrationPhone },
        ],
      },
      select: { email: true, phone: true },
    })
    if (matches.some(match => match.email.toLowerCase() === registrationEmail)) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }
    if (matches.some(match => match.phone === registrationPhone)) {
      return NextResponse.json({ error: 'An account with this mobile number already exists.' }, { status: 409 })
    }
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const { success } = await rateLimit(`otp:${parsed.data.purpose}:${ip}:${identifier}`, 5, 15 * 60 * 1000)
  if (!success) return NextResponse.json({ error: 'Too many OTP requests. Try again later.' }, { status: 429 })

  const deliveryIdentifier = parsed.data.purpose === 'register'
    ? registrationEmail as string
    : user?.email as string

  const { code } = await createOtpChallenge(deliveryIdentifier, parsed.data.purpose)
  try {
    const delivery = await deliverOtp(deliveryIdentifier, code, parsed.data.purpose)
    return NextResponse.json({
      message: delivery.delivered ? `OTP sent to ${delivery.sentTo}` : 'Demo OTP generated',
      channel: delivery.channel,
      sentTo: delivery.sentTo,
      ...(!delivery.delivered && process.env.NODE_ENV !== 'production' ? { demoOtp: code } : {}),
    })
  } catch (error) {
    await prisma.otpChallenge.deleteMany({ where: { identifier: deliveryIdentifier, purpose: parsed.data.purpose } })
    console.error('OTP delivery error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'OTP could not be delivered. Please try again.' }, { status: 503 })
  }
}
