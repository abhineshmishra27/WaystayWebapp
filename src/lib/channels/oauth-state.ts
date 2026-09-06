import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signs the `state` carried through the Cloudbeds OAuth round trip.
 *
 * An unsigned state is the classic hole in this flow: the callback would accept any
 * `code` an attacker delivered to it, and the resulting connection - somebody else's
 * property, or their tokens - would be attached to this account. Signing means the
 * callback only honours a round trip this server started.
 *
 * The payload also carries who started it and which owner the imported hotels are for,
 * so those cannot be swapped in the query string on the way back.
 */

const STATE_VERSION = 'v1'
/** Long enough for a human to complete a consent screen, short enough to limit replay. */
const STATE_TTL_MS = 10 * 60 * 1000

export type OAuthStatePayload = {
  /** Admin who initiated the connection. */
  adminId: string
  /** The OWNER user that imported hotels will belong to. */
  ownerId: string
  nonce: string
  expiresAt: number
}

/**
 * Derived from the channel credentials key rather than adding another secret to
 * configure. A distinct label keeps this HMAC unrelated to the encryption use, so one
 * cannot be used to attack the other.
 */
function signingKey() {
  const configured = process.env.CHANNEL_CREDENTIALS_KEY
  if (!configured) throw new Error('CHANNEL_CREDENTIALS_KEY is required to sign the OAuth state')
  return createHmac('sha256', Buffer.from(configured, 'base64')).update('cloudbeds-oauth-state').digest()
}

function sign(body: string) {
  return createHmac('sha256', signingKey()).update(body).digest('base64url')
}

export function createOAuthState(input: { adminId: string; ownerId: string }) {
  const payload: OAuthStatePayload = {
    adminId: input.adminId,
    ownerId: input.ownerId,
    nonce: randomBytes(16).toString('base64url'),
    expiresAt: Date.now() + STATE_TTL_MS,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${STATE_VERSION}.${body}.${sign(body)}`
}

export class InvalidOAuthStateError extends Error {
  constructor(reason: string) {
    super(`OAuth state rejected: ${reason}`)
    this.name = 'InvalidOAuthStateError'
  }
}

export function verifyOAuthState(state: string | null): OAuthStatePayload {
  if (!state) throw new InvalidOAuthStateError('missing')

  const parts = state.split('.')
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) {
    throw new InvalidOAuthStateError('malformed or unsupported version')
  }

  const [, body, signature] = parts
  const expected = sign(body)
  const provided = Buffer.from(signature, 'utf8')
  const computed = Buffer.from(expected, 'utf8')
  // Constant time, and length-checked first because timingSafeEqual throws on a mismatch.
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new InvalidOAuthStateError('signature does not match')
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidOAuthStateError('payload is not readable')
  }

  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) {
    throw new InvalidOAuthStateError('expired')
  }
  if (!payload.adminId || !payload.ownerId) {
    throw new InvalidOAuthStateError('payload is incomplete')
  }

  return payload
}
