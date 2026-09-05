import test from 'node:test'
import assert from 'node:assert/strict'
import {
  heldUnitsForRequest,
  requestHasCapacity,
  requestHoldDates,
  slotIsUnavailable,
  type ActiveBookingWindow,
  type InventoryHold,
} from '../src/lib/booking-inventory.ts'

function booking(
  slotType: string,
  startTime: string,
  endTime: string,
  date = '2026-08-20',
  totalHours = 3,
  roomCount = 1,
): ActiveBookingWindow {
  return { totalHours, roomCount, roomSlot: { date, slotType, startTime, endTime } }
}

const nightRequest = {
  dates: ['2026-08-20'],
  slotType: 'FULLDAY',
  startTime: '12:00',
  endTime: '11:00',
}

const morningRequest = {
  dates: ['2026-08-20'],
  slotType: 'H3',
  startTime: '06:00',
  endTime: '09:00',
}

test('a night request only checks holds on the nights it covers', () => {
  assert.deepEqual(requestHoldDates({ ...nightRequest, dates: ['2026-08-20', '2026-08-21'] }), [
    '2026-08-20',
    '2026-08-21',
  ])
})

test('an hourly request that runs past midnight also checks the next day', () => {
  assert.deepEqual(
    requestHoldDates({ dates: ['2026-08-20'], slotType: 'H6', startTime: '21:00', endTime: '03:00' }),
    ['2026-08-20', '2026-08-21'],
  )
})

test('an hourly request inside one day does not reach into the next day', () => {
  assert.deepEqual(requestHoldDates(morningRequest), ['2026-08-20'])
})

test('holds on unrelated dates are ignored', () => {
  const holds: InventoryHold[] = [{ date: '2026-09-01', unitsHeld: 5 }]
  assert.equal(heldUnitsForRequest(holds, nightRequest), 0)
})

test('holds are not summed across dates - the busiest night decides', () => {
  const holds: InventoryHold[] = [
    { date: '2026-08-20', unitsHeld: 2 },
    { date: '2026-08-21', unitsHeld: 3 },
  ]
  const request = { ...nightRequest, dates: ['2026-08-20', '2026-08-21'] }
  assert.equal(heldUnitsForRequest(holds, request), 3)
})

test('negative or fractional held units are clamped, never credited back', () => {
  assert.equal(heldUnitsForRequest([{ date: '2026-08-20', unitsHeld: -4 }], nightRequest), 0)
  assert.equal(heldUnitsForRequest([{ date: '2026-08-20', unitsHeld: 1.9 }], nightRequest), 1)
})

test('a channel hold consumes inventory the same way a booking does', () => {
  const holds: InventoryHold[] = [{ date: '2026-08-20', unitsHeld: 1 }]
  // 2 units, nothing booked: available without holds, unavailable once 1 is held and 2 requested.
  assert.equal(requestHasCapacity([], nightRequest, 2, 2), true)
  assert.equal(requestHasCapacity([], nightRequest, 2, 2, holds), false)
  assert.equal(requestHasCapacity([], nightRequest, 2, 1, holds), true)
})

test('holds and active bookings stack against the same inventory', () => {
  const holds: InventoryHold[] = [{ date: '2026-08-20', unitsHeld: 1 }]
  const existing = [booking('FULLDAY', '12:00', '11:00', '2026-08-20', 24)]
  // 2 units: one sold on the channel, one booked on WayStay - nothing left.
  assert.equal(requestHasCapacity(existing, nightRequest, 2, 1, holds), false)
  assert.equal(requestHasCapacity(existing, nightRequest, 3, 1, holds), true)
})

test('a fully held room reports as unavailable through slotIsUnavailable', () => {
  const holds: InventoryHold[] = [{ date: '2026-08-20', unitsHeld: 1 }]
  const slot = { date: '2026-08-20', slotType: 'FULLDAY', startTime: '12:00', endTime: '11:00' }
  assert.equal(slotIsUnavailable(slot, [], '2026-08-21', 1, 1), false)
  assert.equal(slotIsUnavailable(slot, [], '2026-08-21', 1, 1, holds), true)
})

test('a nightly channel hold also blocks hourly stays that day', () => {
  const holds: InventoryHold[] = [{ date: '2026-08-20', unitsHeld: 1 }]
  // Conservative by design: a room sold for the night cannot be resold by the hour.
  assert.equal(requestHasCapacity([], morningRequest, 1, 1, holds), false)
})

test('no holds means capacity behaves exactly as before', () => {
  assert.equal(requestHasCapacity([], nightRequest, 1, 1, []), requestHasCapacity([], nightRequest, 1, 1))
  const existing = [booking('H3', '06:00', '09:00')]
  assert.equal(
    requestHasCapacity(existing, morningRequest, 2, 1, []),
    requestHasCapacity(existing, morningRequest, 2, 1),
  )
})
