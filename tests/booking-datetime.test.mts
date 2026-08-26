import assert from 'node:assert/strict'
import test from 'node:test'
import { bookingHasEnded, createBookingDateTimes, effectiveBookingCheckOut } from '../src/lib/booking-datetime.ts'

test('a single full-day stay checks out the following morning', () => {
  const { checkIn, checkOut } = createBookingDateTimes({
    startDate: '2026-08-23',
    endDate: '2026-08-24',
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  })

  assert.equal(checkIn.toISOString(), '2026-08-23T06:30:00.000Z')
  assert.equal(checkOut.toISOString(), '2026-08-24T05:30:00.000Z')
})

test('a multi-day full-day stay checks out after the final booked night', () => {
  const { checkOut } = createBookingDateTimes({
    startDate: '2026-08-23',
    endDate: '2026-08-25',
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  })

  assert.equal(checkOut.toISOString(), '2026-08-25T05:30:00.000Z')
})

test('legacy same-date full-day ranges still represent one night', () => {
  const { checkOut } = createBookingDateTimes({
    startDate: '2026-08-23',
    endDate: '2026-08-23',
    slotType: 'FULLDAY',
    startTime: '12:00',
    endTime: '11:00',
  })

  assert.equal(checkOut.toISOString(), '2026-08-24T05:30:00.000Z')
})

test('hourly stays keep checkout on the selected date', () => {
  const { checkOut } = createBookingDateTimes({
    startDate: '2026-08-23',
    endDate: '2026-08-23',
    slotType: 'H3',
    startTime: '15:00',
    endTime: '18:00',
  })

  assert.equal(checkOut.toISOString(), '2026-08-23T12:30:00.000Z')
})

test('historical under-length full-day checkout values are repaired for classification', () => {
  const booking = {
    checkIn: '2026-08-23T06:30:00.000Z',
    checkOut: '2026-08-23T05:30:00.000Z',
    totalHours: 24,
    roomSlot: { slotType: 'FULLDAY' },
  }

  assert.equal(effectiveBookingCheckOut({ ...booking, slotType: booking.roomSlot.slotType }).toISOString(), '2026-08-24T05:30:00.000Z')
  assert.equal(bookingHasEnded(booking, new Date('2026-08-23T12:00:00.000Z')), false)
})
