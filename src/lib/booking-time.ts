const BOOKING_TIME_ZONE = 'Asia/Kolkata'

function dateTimeParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''

  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: (Number(value('hour')) * 60) + Number(value('minute')),
  }
}

export function todayInIndia(now = new Date()) {
  return dateTimeParts(now).date
}

function followingDate(date: string) {
  const nextDate = new Date(`${date}T00:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  return nextDate.toISOString().slice(0, 10)
}

export function defaultSearchDateForSlot(slotType: string, now = new Date()) {
  const current = dateTimeParts(now)
  const finalStartMinutes: Record<string, number> = {
    H3: 15 * 60,
    H6: 12 * 60,
    H12: 6 * 60,
  }
  const finalStart = finalStartMinutes[slotType]
  return finalStart !== undefined && current.minutes >= finalStart
    ? followingDate(current.date)
    : current.date
}

export function slotHasStarted(date: string, startTime: string, now = new Date()) {
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(startTime)
  if (!dateMatch || !timeMatch) return true

  const hours = Number(timeMatch[1])
  const minutes = Number(timeMatch[2])
  if (hours > 23 || minutes > 59) return true

  const current = dateTimeParts(now)
  if (date !== current.date) return date < current.date

  return (hours * 60) + minutes <= current.minutes
}

export function slotIsPastForBooking(slotType: string, date: string, startTime: string, now = new Date()) {
  return slotType !== 'FULLDAY' && slotHasStarted(date, startTime, now)
}
