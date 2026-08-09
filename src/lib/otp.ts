import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  return digits.slice(-10)
}

export function normalizeIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? value : normalizePhone(value)
}

function hashOtp(identifier: string, purpose: 'login' | 'register', code: string) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required')
  return createHmac('sha256', secret).update(`${purpose}:${identifier}:${code}`).digest('hex')
}

export async function createOtpChallenge(identifier: string, purpose: 'login' | 'register') {
  const normalizedIdentifier = normalizeIdentifier(identifier)
  const code = String(randomInt(100000, 1000000))
  const { prisma } = await import('@/lib/db')

  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({
      where: { identifier: normalizedIdentifier, purpose },
    }),
    prisma.otpChallenge.create({
      data: {
        identifier: normalizedIdentifier,
        purpose,
        codeHash: hashOtp(normalizedIdentifier, purpose, code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    }),
  ])

  return { normalizedIdentifier, code }
}

export async function verifyOtp(identifier: string, purpose: 'login' | 'register', code: string) {
  const normalizedIdentifier = normalizeIdentifier(identifier)
  const { prisma } = await import('@/lib/db')
  const challenge = await prisma.otpChallenge.findFirst({
    where: { identifier: normalizedIdentifier, purpose },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge || challenge.expiresAt.getTime() < Date.now() || challenge.attempts >= 5) return false

  const suppliedHash = hashOtp(normalizedIdentifier, purpose, code)
  const storedBuffer = Buffer.from(challenge.codeHash, 'hex')
  const suppliedBuffer = Buffer.from(suppliedHash, 'hex')
  const matches = storedBuffer.length === suppliedBuffer.length && timingSafeEqual(storedBuffer, suppliedBuffer)
  if (!matches) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    })
    return false
  }

  await prisma.otpChallenge.delete({ where: { id: challenge.id } })
  return true
}
