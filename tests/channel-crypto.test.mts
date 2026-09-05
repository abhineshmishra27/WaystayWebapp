import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// crypto.ts is server-only; the module import below needs the key present up front.
process.env.CHANNEL_CREDENTIALS_KEY ??= randomBytes(32).toString('base64')

const { encryptSecret, decryptSecret, secretsMatch, channelCredentialsKeyIsConfigured } = await import(
  '../src/lib/crypto.ts'
)

test('a credential survives a round trip', () => {
  const token = 'cb_access_token_abc123'
  assert.equal(decryptSecret(encryptSecret(token)), token)
})

test('the same plaintext encrypts differently every time', () => {
  const first = encryptSecret('same-token')
  const second = encryptSecret('same-token')
  assert.notEqual(first, second)
  assert.equal(decryptSecret(first), decryptSecret(second))
})

test('the envelope is versioned so keys can be rotated later', () => {
  assert.match(encryptSecret('token'), /^v1\./)
})

test('the plaintext never appears in the envelope', () => {
  assert.ok(!encryptSecret('super-secret-token').includes('super-secret-token'))
})

test('tampering with the ciphertext is detected', () => {
  const envelope = encryptSecret('token')
  const parts = envelope.split('.')
  const tampered = Buffer.from(parts[3], 'base64url')
  tampered[0] ^= 0xff
  parts[3] = tampered.toString('base64url')
  assert.throws(() => decryptSecret(parts.join('.')))
})

test('a malformed or wrong-version envelope is rejected', () => {
  assert.throws(() => decryptSecret('not-an-envelope'))
  assert.throws(() => decryptSecret('v2.aaa.bbb.ccc'))
})

test('an envelope from a different key cannot be read', () => {
  const envelope = encryptSecret('token')
  const original = process.env.CHANNEL_CREDENTIALS_KEY
  process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString('base64')
  assert.throws(() => decryptSecret(envelope))
  process.env.CHANNEL_CREDENTIALS_KEY = original
})

test('empty credentials are refused rather than stored as blanks', () => {
  assert.throws(() => encryptSecret(''))
})

test('a key of the wrong length is rejected loudly', () => {
  const original = process.env.CHANNEL_CREDENTIALS_KEY
  process.env.CHANNEL_CREDENTIALS_KEY = Buffer.from('too-short').toString('base64')
  assert.equal(channelCredentialsKeyIsConfigured(), false)
  assert.throws(() => encryptSecret('token'), /32 bytes/)
  process.env.CHANNEL_CREDENTIALS_KEY = original
  assert.equal(channelCredentialsKeyIsConfigured(), true)
})

test('shared-secret comparison rejects mismatches and length differences', () => {
  assert.equal(secretsMatch('abc123', 'abc123'), true)
  assert.equal(secretsMatch('abc123', 'abc124'), false)
  assert.equal(secretsMatch('abc', 'abc123'), false)
  assert.equal(secretsMatch(null, 'abc'), false)
  assert.equal(secretsMatch('abc', undefined), false)
  assert.equal(secretsMatch('', ''), false)
})
