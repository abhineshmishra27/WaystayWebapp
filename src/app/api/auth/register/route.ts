import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { normalizePhone, verifyOtp } from '@/lib/otp'

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit OTP').optional(),
  password: z.string().optional(),
  role: z.enum(['OWNER', 'CUSTOMER']),
}).superRefine((data, ctx) => {
  if (data.otp) return
  if (!data.password || data.password.length < 8 || !/[A-Z]/.test(data.password) || !/[0-9]/.test(data.password)) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must be 8+ characters with uppercase and number' })
  }
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, password, role, otp } = parsed.data
    const phone = normalizePhone(parsed.data.phone)
    if (otp && !verifyOtp(phone, 'register', otp)) {
      return NextResponse.json({ error: 'Incorrect or expired OTP. Request a new code.' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'local'
    const { success } = rateLimit(`register:${ip}:${email}`, 5, 60 * 60 * 1000)

    if (!success) {
      return NextResponse.json(
        { error: 'Too many registration attempts for this email. Try again in an hour.' },
        { status: 429 }
      )
    }

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(
      password || `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`,
      12,
    )

    const user = await prisma.user.create({
      data: { name, email, phone, passwordHash, role },
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json(
      { message: 'Account created successfully', user },
      { status: 201 }
    )
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
