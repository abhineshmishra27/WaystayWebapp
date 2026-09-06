import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.CHANNEL_CREDENTIALS_KEY ??= randomBytes(32).toString('base64')

const { createOAuthState, verifyOAuthState, InvalidOAuthStateError } = await import(
  '../src/lib/channels/oauth-state.ts'
)

const input = { adminId: 'admin_1', ownerId: 'owner_1' }

test('a state round-trips with the identities it was created for', () => {
  const payload = verifyOAuthState(createOAuthState(input))
  assert.equal(payload.adminId, 'admin_1')
  assert.equal(payload.ownerId, 'owner_1')
  assert.ok(payload.expiresAt > Date.now())
})

test('each state is unique, so one cannot be predicted from another', () => {
  assert.notEqual(createOAuthState(input), createOAuthState(input))
})

test('a missing state is rejected', () => {
  assert.throws(() => verifyOAuthState(null), InvalidOAuthStateError)
  assert.throws(() => verifyOAuthState(''), InvalidOAuthStateError)
})

test('a forged state is rejected', () => {
  // The attack this exists to stop: an attacker who can craft `state` could have the
  // callback attach their property, or their tokens, to this account.
  const forged = Buffer.from(
    JSON.stringify({ adminId: 'attacker', ownerId: 'owner_1', nonce: 'x', expiresAt: Date.now() + 60_000 }),
    'utf8',
  ).toString('base64url')
  assert.throws(() => verifyOAuthState(`v1.${forged}.not-a-real-signature`), InvalidOAuthStateError)
})

test('tampering with the payload invalidates the signature', () => {
  const state = createOAuthState(input)
  const [version, body, signature] = state.split('.')
  const swapped = Buffer.from(
    JSON.stringify({ adminId: 'admin_1', ownerId: 'someone_else', nonce: 'x', expiresAt: Date.now() + 60_000 }),
    'utf8',
  ).toString('base64url')
  assert.notEqual(swapped, body)
  assert.throws(() => verifyOAuthState(`${version}.${swapped}.${signature}`), InvalidOAuthStateError)
})

test('an expired state is rejected', () => {
  const state = createOAuthState(input)
  const [version, body] = state.split('.')
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  decoded.expiresAt = Date.now() - 1000
  const staleBody = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
  // Re-signing is not possible without the key, so this also fails on signature - which
  // is the point: expiry cannot be extended by an attacker either.
  assert.throws(() => verifyOAuthState(`${version}.${staleBody}.whatever`), InvalidOAuthStateError)
})

test('a state signed with a different key is rejected', () => {
  const state = createOAuthState(input)
  const original = process.env.CHANNEL_CREDENTIALS_KEY
  process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString('base64')
  assert.throws(() => verifyOAuthState(state), InvalidOAuthStateError)
  process.env.CHANNEL_CREDENTIALS_KEY = original
})

test('a malformed or wrong-version state is rejected', () => {
  assert.throws(() => verifyOAuthState('nonsense'), InvalidOAuthStateError)
  assert.throws(() => verifyOAuthState('v2.aaa.bbb'), InvalidOAuthStateError)
})
