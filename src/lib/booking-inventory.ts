export type SlotWindow = {
  date: string
  slotType: string
  startTime: string
  endTime: string
}

export type ActiveBookingWindow = {
  totalHours: number
  roomCount?: number
  roomSlot: SlotWindow
}

export type RequestedWindow = {
  dates: string[]
  slotType: string
  startTime: string
  endTime: string
}

const DAY_MS = 86_400_000

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

export function fullDayStayDates(checkInDate: string, checkOutDate: string) {
  const checkInMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkInDate)
  const checkOutMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkOutDate)
  if (!checkInMatch || !checkOutMatch) return []

  const checkIn = Date.UTC(Number(checkInMatch[1]), Number(checkInMatch[2]) - 1, Number(checkInMatch[3]))
  const checkOut = Date.UTC(Number(checkOutMatch[1]), Number(checkOutMatch[2]) - 1, Number(checkOutMatch[3]))
  if (checkOut < checkIn) return []
  if (checkOut === checkIn) return [checkInDate]

  const finalNight = new Date(checkOut - DAY_MS).toISOString().slice(0, 10)
  return dateRangeStrings(checkInDate, finalNight)
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

type TimestampWindow = {
  start: number
  end: number
}

function timestampFor(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return Number.NaN
  return Date.parse(`${date}T${time}:00Z`)
}

function hourlyWindow(date: string, startTime: string, endTime: string): TimestampWindow | null {
  const start = timestampFor(date, startTime)
  let end = timestampFor(date, endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) end += DAY_MS
  return { start, end }
}

function bookingWindow(booking: ActiveBookingWindow): TimestampWindow | null {
  const window = hourlyWindow(
    booking.roomSlot.date,
    booking.roomSlot.startTime,
    booking.roomSlot.endTime,
  )
  if (!window || booking.roomSlot.slotType !== 'FULLDAY') return window

  const numberOfDays = Math.max(1, Math.round(booking.totalHours / 24))
  return { start: window.start, end: window.end + ((numberOfDays - 1) * DAY_MS) }
}

function requestedWindow(request: RequestedWindow): TimestampWindow | null {
  if (request.dates.length === 0) return null
  const firstDate = request.dates[0]
  const lastDate = request.dates[request.dates.length - 1]
  const firstWindow = hourlyWindow(firstDate, request.startTime, request.endTime)
  if (!firstWindow) return null
  if (request.slotType !== 'FULLDAY') return firstWindow

  const end = timestampFor(lastDate, request.endTime)
  if (!Number.isFinite(end)) return null
  return { start: firstWindow.start, end: end + DAY_MS }
}

function windowsOverlap(first: TimestampWindow, second: TimestampWindow) {
  return first.start < second.end && first.end > second.start
}

export function bookingConflictsWithRequest(booking: ActiveBookingWindow, request: RequestedWindow) {
  const existing = bookingWindow(booking)
  const requested = requestedWindow(request)
  return Boolean(existing && requested && windowsOverlap(existing, requested))
}

export function maximumReservedRooms(activeBookings: ActiveBookingWindow[], request: RequestedWindow) {
  const requested = requestedWindow(request)
  if (!requested) return Number.POSITIVE_INFINITY

  const events: Array<{ timestamp: number; roomDelta: number }> = []
  for (const booking of activeBookings) {
    const existing = bookingWindow(booking)
    if (!existing || !windowsOverlap(existing, requested)) continue
    const roomCount = Math.max(1, Math.floor(booking.roomCount ?? 1))
    events.push({ timestamp: Math.max(existing.start, requested.start), roomDelta: roomCount })
    events.push({ timestamp: Math.min(existing.end, requested.end), roomDelta: -roomCount })
  }

  events.sort((first, second) =>
    first.timestamp - second.timestamp || first.roomDelta - second.roomDelta
  )

  let reservedRooms = 0
  let maximum = 0
  for (const event of events) {
    reservedRooms += event.roomDelta
    maximum = Math.max(maximum, reservedRooms)
  }
  return maximum
}

export function requestHasCapacity(
  activeBookings: ActiveBookingWindow[],
  request: RequestedWindow,
  inventoryCount = 1,
  requestedRoomCount = 1,
) {
  const inventory = Math.max(1, Math.floor(inventoryCount))
  const requestedRooms = Math.max(1, Math.floor(requestedRoomCount))
  return maximumReservedRooms(activeBookings, request) + requestedRooms <= inventory
}

export function slotIsUnavailable(
  slot: SlotWindow,
  activeBookings: ActiveBookingWindow[],
  requestedEndDate = slot.date,
  inventoryCount = 1,
  requestedRoomCount = 1,
) {
  const dates = slot.slotType === 'FULLDAY'
    ? fullDayStayDates(slot.date, requestedEndDate)
    : [slot.date]
  if (dates.length === 0) return true
  return !requestHasCapacity(activeBookings, {
    dates,
    slotType: slot.slotType,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }, inventoryCount, requestedRoomCount)
}
