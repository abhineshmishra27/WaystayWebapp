type OtpChallenge = {
  code: string
  expiresAt: number
  attempts: number
}

const challenges = new Map<string, OtpChallenge>()

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^91/, '').slice(-10)
}

export function normalizeIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? value : normalizePhone(value)
}

export function createOtpChallenge(identifier: string, purpose: 'login' | 'register') {
  const normalizedIdentifier = normalizeIdentifier(identifier)
  const code = String(Math.floor(100000 + Math.random() * 900000))
  challenges.set(`${purpose}:${normalizedIdentifier}`, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  })
  return { normalizedIdentifier, code }
}

export function verifyOtp(identifier: string, purpose: 'login' | 'register', code: string) {
  const key = `${purpose}:${normalizeIdentifier(identifier)}`
  const challenge = challenges.get(key)
  if (!challenge || challenge.expiresAt < Date.now() || challenge.attempts >= 5) return false

  challenge.attempts += 1
  if (challenge.code !== code) return false

  challenges.delete(key)
  return true
}
