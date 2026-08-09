import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/otp'
import { rateLimit } from '@/lib/rate-limit'

const schema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), phone: z.string() }),
  z.object({ purpose: z.literal('register'), phone: z.string(), email: z.string().email() }),
])

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email and mobile number.' }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number.' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const { success } = rateLimit(`firebase-phone:${parsed.data.purpose}:${ip}:${phone}`, 5, 15 * 60 * 1000)
  if (!success) {
    return NextResponse.json({ error: 'Too many OTP requests. Try again later.' }, { status: 429 })
  }

  const { prisma } = await import('@/lib/db')
  if (parsed.data.purpose === 'login') {
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { isActive: true },
    })
    if (!user?.isActive) {
      return NextResponse.json({ error: 'No active account matches that mobile number.' }, { status: 404 })
    }
  } else {
    const email = parsed.data.email.trim().toLowerCase()
    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { phone },
        ],
      },
      select: { email: true, phone: true },
    })
    if (matches.some(user => user.email.toLowerCase() === email)) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }
    if (matches.some(user => user.phone === phone)) {
      return NextResponse.json({ error: 'An account with this mobile number already exists.' }, { status: 409 })
    }
  }

  return NextResponse.json({ ok: true, phone })
}
