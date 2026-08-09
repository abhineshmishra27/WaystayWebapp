import { NextRequest, NextResponse } from 'next/server'
import { createOtpChallenge, normalizeIdentifier } from '@/lib/otp'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  identifier: z.string().min(3, 'Enter your email or mobile number'),
  purpose: z.enum(['login', 'register']),
})

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })

  const identifier = normalizeIdentifier(parsed.data.identifier)
  if (parsed.data.purpose === 'register' && !/^[6-9]\d{9}$/.test(identifier)) {
    return NextResponse.json({ error: 'Enter a valid 10-digit mobile number.' }, { status: 400 })
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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const { success } = rateLimit(`otp:${parsed.data.purpose}:${ip}:${identifier}`, 5, 15 * 60 * 1000)
  if (!success) return NextResponse.json({ error: 'Too many OTP requests. Try again later.' }, { status: 429 })

  const { code } = await createOtpChallenge(identifier, parsed.data.purpose)
  // Wire the returned targets to the SMS/email provider in production.
  return NextResponse.json({
    message: 'OTP sent successfully',
    channels: parsed.data.purpose === 'login' ? ['email', 'sms'] : ['sms'],
    ...(user ? { sentTo: { email: user.email, phone: user.phone } } : {}),
    ...(process.env.NODE_ENV !== 'production' ? { demoOtp: code } : {}),
  })
}
