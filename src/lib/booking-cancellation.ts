type CancellableBooking = {
  status: string
  checkIn: Date | string
}

export function canCancelBooking(booking: CancellableBooking, now = new Date()) {
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) return false
  const checkIn = booking.checkIn instanceof Date ? booking.checkIn : new Date(booking.checkIn)
  return Number.isFinite(checkIn.getTime()) && checkIn.getTime() > now.getTime()
}
