export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^91/, '').slice(-10)
}

export function normalizeIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? value : normalizePhone(value)
}

async function hashOtp(identifier: string, purpose: 'login' | 'register', code: string) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required')
  const value = new TextEncoder().encode(`${secret}:${purpose}:${identifier}:${code}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createOtpChallenge(identifier: string, purpose: 'login' | 'register') {
  const normalizedIdentifier = normalizeIdentifier(identifier)
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const { prisma } = await import('@/lib/db')

  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({
      where: { identifier: normalizedIdentifier, purpose },
    }),
    prisma.otpChallenge.create({
      data: {
        identifier: normalizedIdentifier,
        purpose,
        codeHash: await hashOtp(normalizedIdentifier, purpose, code),
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

  const suppliedHash = await hashOtp(normalizedIdentifier, purpose, code)
  if (challenge.codeHash !== suppliedHash) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    })
    return false
  }

  await prisma.otpChallenge.delete({ where: { id: challenge.id } })
  return true
}
