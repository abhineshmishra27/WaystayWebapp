export type SlotWindow = {
  date: string
  slotType: string
  startTime: string
  endTime: string
}

export type ActiveBookingWindow = {
  totalHours: number
  roomSlot: SlotWindow
}

export type RequestedWindow = {
  dates: string[]
  slotType: string
  startTime: string
  endTime: string
}

export function dateRangeStrings(startDate: string, endDate: string) {
  const matchStart = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
  const matchEnd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate)
  if (!matchStart || !matchEnd) return []

  const start = Date.UTC(Number(matchStart[1]), Number(matchStart[2]) - 1, Number(matchStart[3]))
  const end = Date.UTC(Number(matchEnd[1]), Number(matchEnd[2]) - 1, Number(matchEnd[3]))
  if (end < start) return []

  const dates: string[] = []
  for (let timestamp = start; timestamp <= end; timestamp += 86_400_000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10))
  }
  return dates
}

export function bookingCoveredDates(booking: ActiveBookingWindow) {
  if (booking.roomSlot.slotType !== 'FULLDAY') return [booking.roomSlot.date]
  const numberOfDays = Math.max(1, Math.round(booking.totalHours / 24))
  const endTimestamp = new Date(`${booking.roomSlot.date}T00:00:00Z`).getTime() + ((numberOfDays - 1) * 86_400_000)
  return dateRangeStrings(booking.roomSlot.date, new Date(endTimestamp).toISOString().slice(0, 10))
}

export function timesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return firstStart < secondEnd && firstEnd > secondStart
}

export function bookingConflictsWithRequest(booking: ActiveBookingWindow, request: RequestedWindow) {
  const coveredDates = new Set(bookingCoveredDates(booking))
  const sameDate = request.dates.some(date => coveredDates.has(date))
  if (!sameDate) return false
  if (booking.roomSlot.slotType === 'FULLDAY' || request.slotType === 'FULLDAY') return true
  return timesOverlap(
    booking.roomSlot.startTime,
    booking.roomSlot.endTime,
    request.startTime,
    request.endTime,
  )
}

export function slotIsUnavailable(
  slot: SlotWindow,
  activeBookings: ActiveBookingWindow[],
  requestedEndDate = slot.date,
) {
  const dates = slot.slotType === 'FULLDAY'
    ? dateRangeStrings(slot.date, requestedEndDate)
    : [slot.date]
  if (dates.length === 0) return true
  return activeBookings.some(booking => bookingConflictsWithRequest(booking, {
    dates,
    slotType: slot.slotType,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }))
}
