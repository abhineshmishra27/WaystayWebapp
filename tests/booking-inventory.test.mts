import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bookingConflictsWithRequest,
  dateRangeStrings,
  slotIsUnavailable,
  timesOverlap,
  type ActiveBookingWindow,
} from '../src/lib/booking-inventory.ts'

function booking(slotType: string, startTime: string, endTime: string, date = '2026-08-20', totalHours = 3): ActiveBookingWindow {
  return { totalHours, roomSlot: { date, slotType, startTime, endTime } }
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

test('a multi-day full-day booking blocks every slot on every covered date', () => {
  const existing = booking('FULLDAY', '06:00', '20:00', '2026-08-20', 48)
  assert.deepEqual(dateRangeStrings('2026-08-20', '2026-08-21'), ['2026-08-20', '2026-08-21'])
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-21'],
    slotType: 'H3',
    startTime: '15:00',
    endTime: '18:00',
  }), true)
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'H3',
    startTime: '06:00',
    endTime: '09:00',
  }, [existing]), true)
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'H12',
    startTime: '06:00',
    endTime: '18:00',
  }, [existing]), true)
})

test('an unbooked full-day slot remains available through inventory rules', () => {
  assert.equal(slotIsUnavailable({
    date: '2026-08-20',
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  }, []), false)
})

test('a full-day request is blocked by an hourly booking on any requested date', () => {
  const existing = booking('H3', '12:00', '15:00', '2026-08-21')
  assert.equal(bookingConflictsWithRequest(existing, {
    dates: ['2026-08-20', '2026-08-21'],
    slotType: 'FULLDAY',
    startTime: '06:00',
    endTime: '20:00',
  }), true)
})
