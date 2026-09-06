import test from 'node:test'
import assert from 'node:assert/strict'
import { formatLogLine, serializeError } from '../src/lib/logger.ts'

test('a log line is single-line JSON carrying level, event and context', () => {
  const line = formatLogLine('info', 'search.completed', { hotelCount: 3 })
  assert.ok(!line.includes('\n'))
  const parsed = JSON.parse(line)
  assert.equal(parsed.level, 'info')
  assert.equal(parsed.event, 'search.completed')
  assert.equal(parsed.hotelCount, 3)
  assert.ok(Date.parse(parsed.time) > 0)
})

test('an Error survives serialisation instead of becoming {}', () => {
  // The reason console.error(error) was never enough: JSON.stringify(new Error) is '{}'.
  assert.equal(JSON.stringify(new Error('boom')), '{}')

  const parsed = JSON.parse(formatLogLine('error', 'db.failed', undefined, new Error('boom')))
  assert.equal(parsed.error.name, 'Error')
  assert.equal(parsed.error.message, 'boom')
  assert.ok(typeof parsed.error.stack === 'string')
})

test('a cause chain is followed so the original reason is kept', () => {
  const root = new Error('ECONNREFUSED')
  const wrapper = new Error('Cloudbeds did not respond', { cause: root })
  const parsed = JSON.parse(formatLogLine('error', 'channel.failed', undefined, wrapper))
  assert.equal(parsed.error.message, 'Cloudbeds did not respond')
  assert.equal(parsed.error.cause.message, 'ECONNREFUSED')
})

test('custom error fields are preserved', () => {
  class ApiError extends Error {
    status = 503
    retryable = true
  }
  const parsed = JSON.parse(formatLogLine('error', 'api.failed', undefined, new ApiError('unavailable')))
  assert.equal(parsed.error.status, 503)
  assert.equal(parsed.error.retryable, true)
})

test('a circular cause chain terminates instead of hanging', () => {
  const first = new Error('first')
  const second = new Error('second', { cause: first })
  ;(first as { cause?: unknown }).cause = second
  const line = formatLogLine('error', 'circular', undefined, second)
  assert.ok(line.length > 0)
  assert.ok(!line.includes('\n'))
})

test('non-Error throws are still captured', () => {
  assert.deepEqual(serializeError('just a string'), { value: 'just a string' })
  assert.deepEqual(serializeError({ code: 'P2002' }), { code: 'P2002' })
  assert.equal(serializeError(null), null)
})

test('credentials and guest contact details are redacted from context', () => {
  const parsed = JSON.parse(
    formatLogLine('info', 'booking.created', {
      bookingId: 'bk_1',
      guestEmail: 'guest@example.com',
      guestPhone: '9999999999',
      accessTokenEnc: 'v1.abc.def.ghi',
      passwordHash: '$2a$12$something',
    }),
  )
  assert.equal(parsed.bookingId, 'bk_1', 'non-sensitive fields must survive')
  for (const key of ['guestEmail', 'guestPhone', 'accessTokenEnc', 'passwordHash']) {
    assert.equal(parsed[key], '[redacted]', `${key} must be redacted`)
  }
})

test('a Prisma-style error carrying query metadata is redacted', () => {
  // The case this exists for: serializeError copies every enumerable property, and a
  // Prisma error's meta describes the failed query - guest details included.
  class PrismaLikeError extends Error {
    code = 'P2002'
    meta = { target: ['email'], guestEmail: 'guest@example.com', guestPhone: '9999999999' }
  }
  const parsed = JSON.parse(formatLogLine('error', 'db.failed', undefined, new PrismaLikeError('unique failed')))
  assert.equal(parsed.error.code, 'P2002', 'diagnostic fields must survive')
  assert.equal(parsed.error.meta.guestEmail, '[redacted]')
  assert.equal(parsed.error.meta.guestPhone, '[redacted]')
})

test('an address appearing in free text is scrubbed too', () => {
  const parsed = JSON.parse(formatLogLine('error', 'x', undefined, new Error('No user for guest@example.com')))
  assert.ok(!parsed.error.message.includes('guest@example.com'))
  assert.match(parsed.error.message, /\[redacted\]/)
})

test('innocuous keys that merely contain a sensitive substring are kept', () => {
  // slotPattern contains "otp"; cardinality contains "card". Substring matching would
  // have redacted both, quietly hollowing out useful log lines.
  const parsed = JSON.parse(
    formatLogLine('info', 'sync', { slotPattern: 'FULLDAY', cardinality: 12, tokenExpiresAt: '2026-01-01' }),
  )
  assert.equal(parsed.slotPattern, 'FULLDAY')
  assert.equal(parsed.cardinality, 12)
})

test('redaction is cycle-safe and does not throw', () => {
  const cyclic: Record<string, unknown> = { name: 'loop' }
  cyclic.self = cyclic
  const line = formatLogLine('info', 'cyclic', cyclic)
  assert.ok(line.length > 0)
  assert.equal(JSON.parse(line).event, 'cyclic')
})

test('a context JSON cannot represent at all still does not throw', () => {
  // Cycles are now handled by redaction, so this covers what it cannot fix: BigInt has
  // no JSON representation and makes stringify throw outright.
  const line = formatLogLine('info', 'weird', { count: BigInt(9) })
  const parsed = JSON.parse(line)
  assert.equal(parsed.event, 'weird')
  assert.equal(parsed.contextUnserializable, true)
})
