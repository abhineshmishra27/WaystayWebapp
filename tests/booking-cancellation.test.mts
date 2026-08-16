import assert from 'node:assert/strict'
import test from 'node:test'
import { canCancelBooking } from '../src/lib/booking-cancellation.ts'

const now = new Date('2026-08-16T10:00:00.000Z')

test('a future pending or confirmed booking can be cancelled', () => {
  assert.equal(canCancelBooking({ status: 'PENDING', checkIn: '2026-08-16T10:00:01.000Z' }, now), true)
  assert.equal(canCancelBooking({ status: 'CONFIRMED', checkIn: '2026-08-17T10:00:00.000Z' }, now), true)
})

test('cancellation closes exactly at check-in', () => {
  assert.equal(canCancelBooking({ status: 'CONFIRMED', checkIn: '2026-08-16T10:00:00.000Z' }, now), false)
})

test('a booking with a past check-in cannot be cancelled', () => {
  assert.equal(canCancelBooking({ status: 'CONFIRMED', checkIn: '2026-08-15T10:00:00.000Z' }, now), false)
})

test('terminal booking statuses cannot be cancelled even with a future date', () => {
  assert.equal(canCancelBooking({ status: 'CANCELLED', checkIn: '2026-08-17T10:00:00.000Z' }, now), false)
  assert.equal(canCancelBooking({ status: 'COMPLETED', checkIn: '2026-08-17T10:00:00.000Z' }, now), false)
})

test('invalid check-in values fail closed', () => {
  assert.equal(canCancelBooking({ status: 'CONFIRMED', checkIn: 'not-a-date' }, now), false)
})
