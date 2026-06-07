import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'WayStayy <noreply@waystayy.com>'

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export async function sendWelcomeEmail(email: string, name: string) {
  await resend.emails.send({
    from: FROM, to: email,
    subject: `Welcome to WayStayy, ${name}!`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#4f46e5">Welcome to WayStayy!</h1>
      <p>Hi ${name}, your account has been created successfully.</p>
      <p>Start exploring hotels near you and book by the hour.</p>
      <a href="${process.env.NEXTAUTH_URL}/hotels" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Explore Hotels</a>
    </div>`,
  })
}

interface BookingEmailData {
  guestName: string
  guestEmail: string
  id: string
  checkIn: Date | string
  checkOut: Date | string
  totalAmount: number
  roomSlot?: {
    room?: {
      name?: string
      hotel?: {
        name?: string
      }
    }
  }
}

export async function sendBookingConfirmation(booking: BookingEmailData) {
  const hotel = booking.roomSlot?.room?.hotel
  const room = booking.roomSlot?.room
  await resend.emails.send({
    from: FROM, to: booking.guestEmail,
    subject: `Booking Confirmed — ${hotel?.name || 'WayStayy'}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#4f46e5">Booking Confirmed!</h1>
      <p>Dear ${booking.guestName},</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:8px;color:#666">Booking ID</td><td style="padding:8px;font-weight:bold">${booking.id}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Hotel</td><td style="padding:8px;font-weight:bold">${hotel?.name}</td></tr>
        <tr><td style="padding:8px;color:#666">Room</td><td style="padding:8px">${room?.name}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Check-in</td><td style="padding:8px">${formatDate(booking.checkIn)}</td></tr>
        <tr><td style="padding:8px;color:#666">Check-out</td><td style="padding:8px">${formatDate(booking.checkOut)}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Amount paid</td><td style="padding:8px;font-weight:bold;color:#4f46e5">₹${booking.totalAmount}</td></tr>
      </table>
      <p style="margin-top:24px;color:#666">Thank you for choosing WayStayy!</p>
    </div>`,
  })
}

export async function sendBookingCancellation(
  booking: BookingEmailData,
  refundAmount?: number
) {
  await resend.emails.send({
    from: FROM, to: booking.guestEmail,
    subject: `Booking Cancelled — Refund Initiated`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#ef4444">Booking Cancelled</h1>
      <p>Dear ${booking.guestName}, your booking (ID: ${booking.id}) has been cancelled.</p>
      ${refundAmount ? `<p>A refund of <strong>₹${refundAmount}</strong> will be processed in 5–7 business days.</p>` : ''}
    </div>`,
  })
}

export async function sendHotelStatusEmail(email: string, ownerName: string, hotelName: string, approved: boolean, reason?: string) {
  await resend.emails.send({
    from: FROM, to: email,
    subject: approved ? `✅ ${hotelName} is now live on WayStayy` : `Update on your hotel listing`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:${approved ? '#4f46e5' : '#ef4444'}">${approved ? 'Hotel Approved!' : 'Hotel Not Approved'}</h1>
      <p>Hi ${ownerName},</p>
      <p>${approved ? `Your hotel <strong>${hotelName}</strong> has been approved and is now live on WayStayy.` : `Your hotel <strong>${hotelName}</strong> was not approved at this time.`}</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      ${approved ? `<a href="${process.env.NEXTAUTH_URL}/hotels" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">View your listing</a>` : ''}
    </div>`,
  })
}

interface ReviewNudgeData {
  guestName: string
  guestEmail: string
  id: string
}

export async function sendReviewNudge(booking: ReviewNudgeData, hotelName: string) {
  await resend.emails.send({
    from: FROM, to: booking.guestEmail,
    subject: `How was your stay at ${hotelName}?`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#4f46e5">How was your stay?</h1>
      <p>Dear ${booking.guestName}, we hope you enjoyed your stay!</p>
      <a href="${process.env.NEXTAUTH_URL}/dashboard/bookings/${booking.id}/review" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Write a review</a>
    </div>`,
  })
}
