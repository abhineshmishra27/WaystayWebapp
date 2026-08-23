import assert from 'node:assert/strict'
import test from 'node:test'
import { slotHasStarted, slotIsPastForBooking, todayInIndia } from '../src/lib/booking-time.ts'

const now = new Date('2026-08-22T07:55:00.000Z') // 13:25 in Asia/Kolkata

test('uses the booking timezone for the current date', () => {
  assert.equal(todayInIndia(now), '2026-08-22')
})

test('blocks slots that started earlier today', () => {
  assert.equal(slotHasStarted('2026-08-22', '06:00', now), true)
  assert.equal(slotHasStarted('2026-08-22', '09:00', now), true)
})

test('blocks a slot at its exact starting minute', () => {
  assert.equal(slotHasStarted('2026-08-22', '13:25', now), true)
})

test('allows a later slot today and future dates', () => {
  assert.equal(slotHasStarted('2026-08-22', '15:00', now), false)
  assert.equal(slotHasStarted('2026-08-23', '06:00', now), false)
})

test('only hourly slots expire based on the current time', () => {
  assert.equal(slotIsPastForBooking('H3', '2026-08-22', '06:00', now), true)
  assert.equal(slotIsPastForBooking('H6', '2026-08-22', '06:00', now), true)
  assert.equal(slotIsPastForBooking('H12', '2026-08-22', '06:00', now), true)
  assert.equal(slotIsPastForBooking('FULLDAY', '2026-08-22', '12:00', now), false)
})

test('fails closed for earlier dates and malformed slot values', () => {
  assert.equal(slotHasStarted('2026-08-21', '23:00', now), true)
  assert.equal(slotHasStarted('2026-08-22', '25:00', now), true)
  assert.equal(slotHasStarted('not-a-date', '06:00', now), true)
})
