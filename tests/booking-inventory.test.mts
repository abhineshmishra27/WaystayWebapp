import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bookingConflictsWithRequest,
  dateRangeStrings,
  fullDayStayDates,
  maximumReservedRooms,
  requestHasCapacity,
  slotIsUnavailable,
  timesOverlap,
  type ActiveBookingWindow,
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

test('overlapping slots are detected in either direction', () => {
  assert.equal(timesOverlap('06:00', '09:00', '06:00', '12:00'), true)
  assert.equal(timesOverlap('06:00', '12:00', '09:00', '12:00'), true)
})

test('adjacent slots do not overlap', () => {
  assert.equal(timesOverlap('06:00', '09:00', '09:00', '12:00'), false)
  assert.equal(timesOverlap('09:00', '12:00', '06:00', '09:00'), false)
})

test('a 3-hour 06:00 booking blocks a 6-hour 06:00 request', () => {
  const existing = booking('H3', '06:00', '09:00')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'H6',
    startTime: '06:00',
    endTime: '12:00',
  }), true)
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'H6',
    startTime: '06:00',
    endTime: '12:00',
  }, [existing]), true)
})

test('a later non-overlapping slot remains available', () => {
  const existing = booking('H3', '06:00', '09:00')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'H3',
    startTime: '09:00',
    endTime: '12:00',
  }), false)
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'H3',
    startTime: '15:00',
    endTime: '18:00',
  }, [existing]), false)
})

test('a morning hourly booking does not block a night stay that starts later', () => {
  const existing = booking('H3', '06:00', '09:00')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  }), false)
})

test('an afternoon hourly booking blocks an overlapping night stay', () => {
  const existing = booking('H3', '15:00', '18:00')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  }), true)
})

test('a night stay blocks only hourly slots inside its actual interval', () => {
  const existing = booking('FULLDAY', '12:00', '11:00', '2026-08-20', 24)
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'H3',
    startTime: '06:00',
    endTime: '09:00',
  }), false)
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20'],
    slotType: 'H3',
    startTime: '15:00',
    endTime: '18:00',
  }), true)
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-21'],
    slotType: 'H3',
    startTime: '06:00',
    endTime: '09:00',
  }), true)
})

test('a multi-day night stay covers each night in the requested range', () => {
  const existing = booking('FULLDAY', '12:00', '11:00', '2026-08-20', 48)
  assert.deepEqual(dateRangeStrings('2026-08-20', '2026-08-21'), ['2026-08-20', '2026-08-21'])
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-22'],
    slotType: 'H3',
    startTime: '06:00',
    endTime: '09:00',
  }), true)
})

test('full-day checkout dates are exclusive for pricing and inventory', () => {
  assert.deepEqual(fullDayStayDates('2026-08-26', '2026-08-27'), ['2026-08-26'])
  assert.deepEqual(fullDayStayDates('2026-08-26', '2026-08-28'), ['2026-08-26', '2026-08-27'])
  assert.deepEqual(fullDayStayDates('2026-08-27', '2026-08-26'), [])
})

test('an unbooked full-day slot remains available through inventory rules', () => {
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  }, []), false)
})

test('a multi-day night request is blocked by an overlapping hourly booking', () => {
  const existing = booking('H3', '12:00', '15:00', '2026-08-21')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20', '2026-08-21'],
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  }), true)
})

test('one booked room leaves another room in the same category available', () => {
  const existing = booking('H3', '06:00', '09:00', '2026-08-20', 3, 1)
  const request = {
    dates: ['2026-08-20'],
    slotType: 'H3',
    startTime: '06:00',
    endTime: '09:00',
  }
  assert.equal(requestHasCapacity([existing], request, 2, 1), true)
  assert.equal(requestHasCapacity([existing], request, 2, 2), false)
})

test('non-overlapping bookings are not added together for category capacity', () => {
  const bookings = [
    booking('H3', '06:00', '09:00'),
    booking('H3', '15:00', '18:00'),
  ]
  const request = {
    dates: ['2026-08-20'],
    slotType: 'H12',
    startTime: '06:00',
    endTime: '18:00',
  }
  assert.equal(maximumReservedRooms(bookings, request), 1)
  assert.equal(requestHasCapacity(bookings, request, 2, 1), true)
})

test('overlapping bookings consume category inventory concurrently', () => {
  const bookings = [
    booking('H6', '06:00', '12:00'),
    booking('H6', '09:00', '15:00'),
  ]
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'H12',
    startTime: '06:00',
    endTime: '18:00',
  }, bookings, '2026-08-20', 2, 1), true)
})
