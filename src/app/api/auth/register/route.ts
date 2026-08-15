import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { normalizePhone } from '@/lib/otp'
import { createRegistrationLoginToken } from '@/lib/registration-login-token'
import { verifyFirebasePhoneIdToken } from '@/lib/firebase-admin'
import { isPrimaryAdmin } from '@/lib/rbac'

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  firebaseIdToken: z.string().min(100).optional(),
  password: z.string().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.firebaseIdToken) return
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

    const { name, password, firebaseIdToken } = parsed.data
    const phone = normalizePhone(parsed.data.phone)
    let firebaseIdentity: { uid: string; phone: string } | null = null
    if (firebaseIdToken) {
      try {
        firebaseIdentity = await verifyFirebasePhoneIdToken(firebaseIdToken)
      } catch {
        return NextResponse.json({ error: 'Mobile verification failed. Request a new OTP.' }, { status: 401 })
      }
      if (firebaseIdentity.phone !== phone) {
        return NextResponse.json({ error: 'The verified mobile number does not match this account.' }, { status: 400 })
      }
    }
    const email = parsed.data.email.trim().toLowerCase()
    if (isPrimaryAdmin(email)) {
      return NextResponse.json(
        { error: 'This administrator email is reserved. Sign in with the existing account.' },
        { status: 403 },
      )
    }
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

    const existingUsers = await prisma.user.findMany({
      where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { phone }] },
      select: { email: true, phone: true },
    })
    if (existingUsers.some(user => user.email.toLowerCase() === email)) {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409 }
      )
    }
    if (existingUsers.some(user => user.phone === phone)) {
      return NextResponse.json(
        { error: 'An account with this mobile number already exists.' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(
      password || `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`,
      12,
    )

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        role: 'CUSTOMER',
        firebaseUid: firebaseIdentity?.uid,
        phoneVerifiedAt: firebaseIdentity ? new Date() : undefined,
      },
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user,
        registrationToken: createRegistrationLoginToken(user.id),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Register error:', error)
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'That email address or mobile number is already registered.' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
