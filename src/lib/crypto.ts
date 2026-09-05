import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Envelope encryption for third-party credentials held in the database.
 *
 * Everything else in this app keeps its secrets in flat env vars, which works while
 * there is one secret per provider. Channel connections are per-property and created
 * at runtime by OAuth, so their tokens have to live in Postgres - and a leaked database
 * dump must not hand over the ability to act on a hotelier's PMS account.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const VERSION = 'v1'

class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'CHANNEL_CREDENTIALS_KEY is not configured. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
    this.name = 'MissingEncryptionKeyError'
  }
}

function encryptionKey() {
  const configured = process.env.CHANNEL_CREDENTIALS_KEY
  if (!configured) throw new MissingEncryptionKeyError()

  const key = Buffer.from(configured, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`CHANNEL_CREDENTIALS_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`)
  }
  return key
}

/** True when a usable key is configured, for startup checks and admin diagnostics. */
export function channelCredentialsKeyIsConfigured() {
  try {
    encryptionKey()
    return true
  } catch {
    return false
  }
}

/**
 * Encrypts a credential. Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url - the
 * version prefix is what makes key rotation possible later without guessing at formats.
 */
export function encryptSecret(plaintext: string) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Refusing to encrypt an empty credential')
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptSecret(envelope: string) {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Encrypted credential is malformed or uses an unsupported version')
  }

  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const ciphertext = Buffer.from(parts[3], 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Encrypted credential is malformed')
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv)
  decipher.setAuthTag(tag)
  // Throws if the ciphertext or tag was tampered with - GCM authenticates for us.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Constant-time comparison for shared secrets that arrive in a request (the webhook
 * path secret). Plain `===` on a secret leaks its prefix through timing.
 */
export function secretsMatch(candidate: string | null | undefined, expected: string | null | undefined) {
  if (!candidate || !expected) return false

  const candidateBytes = Buffer.from(candidate, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (candidateBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(candidateBytes, expectedBytes)
}
