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

test('an unserialisable context does not throw', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const line = formatLogLine('info', 'weird', circular)
  const parsed = JSON.parse(line)
  assert.equal(parsed.event, 'weird')
  assert.equal(parsed.contextUnserializable, true)
})
