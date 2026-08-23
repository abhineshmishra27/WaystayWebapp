const INDIA_OFFSET = '+05:30'
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function addDays(date: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error('Invalid booking date')
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + (days * DAY_MS)
  return new Date(timestamp).toISOString().slice(0, 10)
}

function bookingDateTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Invalid booking date or time')
  }
  const value = new Date(`${date}T${time}:00${INDIA_OFFSET}`)
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid booking date or time')
  return value
}

export function createBookingDateTimes({
  startDate,
  endDate,
  slotType,
  startTime,
  endTime,
}: {
  startDate: string
  endDate: string
  slotType: string
  startTime: string
  endTime: string
}) {
  const checkOutDate = slotType === 'FULLDAY' ? addDays(endDate, 1) : endDate
  return {
    checkIn: bookingDateTime(startDate, startTime),
    checkOut: bookingDateTime(checkOutDate, endTime),
  }
}

export function effectiveBookingCheckOut({
  checkIn,
  checkOut,
  totalHours,
  slotType,
}: {
  checkIn: Date | string
  checkOut: Date | string
  totalHours: number
  slotType: string
}) {
  const parsedCheckIn = checkIn instanceof Date ? checkIn : new Date(checkIn)
  const parsedCheckOut = checkOut instanceof Date ? checkOut : new Date(checkOut)
  if (!Number.isFinite(parsedCheckIn.getTime()) || !Number.isFinite(parsedCheckOut.getTime())) return parsedCheckOut
  if (slotType !== 'FULLDAY') return parsedCheckOut

  const minimumExpectedDuration = Math.max(0, totalHours - 1) * HOUR_MS
  return parsedCheckOut.getTime() - parsedCheckIn.getTime() < minimumExpectedDuration
    ? new Date(parsedCheckOut.getTime() + DAY_MS)
    : parsedCheckOut
}

export function bookingHasEnded(
  booking: { checkIn: Date | string; checkOut: Date | string; totalHours: number; roomSlot: { slotType: string } },
  now = new Date(),
) {
  const effectiveCheckOut = effectiveBookingCheckOut({
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    totalHours: booking.totalHours,
    slotType: booking.roomSlot.slotType,
  })
  return Number.isFinite(effectiveCheckOut.getTime()) && effectiveCheckOut.getTime() <= now.getTime()
}
