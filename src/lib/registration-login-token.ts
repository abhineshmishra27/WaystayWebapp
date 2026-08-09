import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_TTL_MS = 5 * 60 * 1000

type RegistrationLoginPayload = {
  sub: string
  purpose: 'registration-login'
  exp: number
}

function getSigningSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required')
  return secret
}

function sign(value: string) {
  return createHmac('sha256', getSigningSecret()).update(value).digest('base64url')
}

export function createRegistrationLoginToken(userId: string) {
  const payload: RegistrationLoginPayload = {
    sub: userId,
    purpose: 'registration-login',
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyRegistrationLoginToken(token: string) {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [encodedPayload, suppliedSignature] = parts
    const expectedSignature = sign(encodedPayload)
    const supplied = Buffer.from(suppliedSignature, 'base64url')
    const expected = Buffer.from(expectedSignature, 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<RegistrationLoginPayload>

    if (
      payload.purpose !== 'registration-login' ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now()
    ) {
      return null
    }

    return payload.sub
  } catch {
    return null
  }
}
