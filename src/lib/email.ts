import { Resend } from 'resend'
import { formatRupees, type MoneyValue } from '@/lib/money'

const FROM = process.env.EMAIL_FROM || 'Waystay <noreply@waystay.co.in>'
type EmailPayload = Parameters<Resend['emails']['send']>[0]

function getResend() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null

  return new Resend(apiKey)
}

async function sendEmail(payload: EmailPayload) {
  const resend = getResend()
  if (!resend) {
    console.warn('Skipping email: RESEND_API_KEY is not configured')
    return
  }

  const { error } = await resend.emails.send(payload)
  if (error) throw new Error(error.message || 'Email delivery failed')
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] || character)
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export async function sendWelcomeEmail(email: string, name: string) {
  await sendEmail({
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
  totalAmount: MoneyValue
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
  await sendEmail({
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
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Amount paid</td><td style="padding:8px;font-weight:bold;color:#4f46e5">₹${formatRupees(booking.totalAmount)}</td></tr>
      </table>
      <p style="margin-top:24px;color:#666">Thank you for choosing WayStayy!</p>
    </div>`,
  })
}

export async function sendBookingCancellation(
  booking: BookingEmailData,
  refundAmount?: number
) {
  await sendEmail({
    from: FROM, to: booking.guestEmail,
    subject: refundAmount ? `Booking Cancelled — Refund Initiated` : `Booking Cancelled`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#ef4444">Booking Cancelled</h1>
      <p>Dear ${booking.guestName}, your booking (ID: ${booking.id}) has been cancelled.</p>
      ${refundAmount ? `<p>A refund of <strong>₹${refundAmount}</strong> will be processed in 5–7 business days.</p>` : ''}
    </div>`,
  })
}

export async function sendHotelStatusEmail(email: string, ownerName: string, hotelName: string, approved: boolean, reason?: string) {
  await sendEmail({
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
  await sendEmail({
    from: FROM, to: booking.guestEmail,
    subject: `How was your stay at ${hotelName}?`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h1 style="color:#4f46e5">How was your stay?</h1>
      <p>Dear ${booking.guestName}, we hope you enjoyed your stay!</p>
      <a href="${process.env.NEXTAUTH_URL}/dashboard/bookings/${booking.id}/review" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Write a review</a>
    </div>`,
  })
}

export interface PartnerApplicationEmailData {
  id: string
  fullName: string
  businessName: string
  email: string
  phone: string
  gstNumber: string
  city: string
  state: string
  propertyCount: number
  message?: string | null
}

export async function sendPartnerApplicationAdminEmail(application: PartnerApplicationEmailData) {
  const adminEmail = process.env.PARTNER_ADMIN_EMAIL || 'waystayrooms@gmail.com'
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3017'
  await sendEmail({
    from: FROM,
    to: adminEmail,
    replyTo: application.email,
    subject: `New hotel-owner application — ${application.businessName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#0f172a">
      <h1 style="font-size:24px;color:#0a2540">New partner onboarding request</h1>
      <p>A hotel owner has shared their intent to onboard with Waystay.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px;color:#64748b">Owner</td><td style="padding:8px;font-weight:600">${escapeHtml(application.fullName)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Business</td><td style="padding:8px;font-weight:600">${escapeHtml(application.businessName)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Email</td><td style="padding:8px">${escapeHtml(application.email)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Phone</td><td style="padding:8px">${escapeHtml(application.phone)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">GST number</td><td style="padding:8px">${escapeHtml(application.gstNumber)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Location</td><td style="padding:8px">${escapeHtml(application.city)}, ${escapeHtml(application.state)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Properties</td><td style="padding:8px">${escapeHtml(application.propertyCount)}</td></tr>
      </table>
      ${application.message ? `<p><strong>Additional information:</strong><br>${escapeHtml(application.message)}</p>` : ''}
      <p style="font-size:12px;color:#64748b">The applicant's password is securely hashed and is never included in email.</p>
      <a href="${baseUrl}/admin/partners" style="display:inline-block;background:#ff6b00;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review application</a>
    </div>`,
  })
}

export async function sendPartnerApplicationDecisionEmail(
  application: Pick<PartnerApplicationEmailData, 'fullName' | 'email'>,
  approved: boolean,
  reason?: string,
) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3017'
  const contactEmail = process.env.PARTNER_ADMIN_EMAIL || 'waystayrooms@gmail.com'
  await sendEmail({
    from: FROM,
    to: application.email,
    replyTo: contactEmail,
    subject: approved ? 'Your Waystay hotel-owner account is approved' : 'Update on your Waystay partner application',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#0f172a">
      <h1 style="color:#0a2540">${approved ? 'Welcome to Waystay partners' : 'Partner application update'}</h1>
      <p>Hi ${escapeHtml(application.fullName)},</p>
      <p>${approved
        ? 'Your hotel-owner account has been approved. You can now sign in using your registered email or mobile number.'
        : 'Your hotel-owner application was not approved at this time.'}</p>
      ${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
      ${approved ? `<p>Please email the complete hotel address, licence details, room inventory, prices, amenities and original photos to <a href="mailto:${contactEmail}">${contactEmail}</a>. A Waystay administrator will create and manage the listing.</p>` : ''}
      ${approved ? `<a href="${baseUrl}/partner" style="display:inline-block;background:#ff6b00;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to owner portal</a>` : ''}
    </div>`,
  })
}

export interface HotelListingRequestEmailData {
  id: string
  hotelName: string
  gstNumber: string
  licenseNumber?: string | null
  address: string
  city: string
  state: string
  pincode: string
  contactPhone: string
  roomCount?: number | null
  message?: string | null
  owner: {
    name: string
    email: string
  }
}

export async function sendHotelListingRequestAdminEmail(request: HotelListingRequestEmailData) {
  const adminEmail = process.env.PARTNER_ADMIN_EMAIL || 'waystayrooms@gmail.com'
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3017'
  await sendEmail({
    from: FROM,
    to: adminEmail,
    replyTo: request.owner.email,
    subject: `Additional hotel listing request — ${request.hotelName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#0f172a">
      <h1 style="font-size:24px;color:#0a2540">Additional hotel listing request</h1>
      <p>An approved Waystay owner has requested another property listing.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px;color:#64748b">Owner</td><td style="padding:8px;font-weight:600">${escapeHtml(request.owner.name)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Owner email</td><td style="padding:8px">${escapeHtml(request.owner.email)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Hotel</td><td style="padding:8px;font-weight:600">${escapeHtml(request.hotelName)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">GST number</td><td style="padding:8px">${escapeHtml(request.gstNumber)}</td></tr>
        ${request.licenseNumber ? `<tr><td style="padding:8px;color:#64748b">Licence number</td><td style="padding:8px">${escapeHtml(request.licenseNumber)}</td></tr>` : ''}
        <tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Address</td><td style="padding:8px">${escapeHtml(request.address)}, ${escapeHtml(request.city)}, ${escapeHtml(request.state)} ${escapeHtml(request.pincode)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Contact phone</td><td style="padding:8px">${escapeHtml(request.contactPhone)}</td></tr>
        ${request.roomCount ? `<tr style="background:#f8fafc"><td style="padding:8px;color:#64748b">Approximate rooms</td><td style="padding:8px">${escapeHtml(request.roomCount)}</td></tr>` : ''}
      </table>
      ${request.message ? `<p><strong>Owner note:</strong><br>${escapeHtml(request.message)}</p>` : ''}
      <a href="${baseUrl}/admin/partners" style="display:inline-block;background:#ff6b00;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review request</a>
    </div>`,
  })
}

export async function sendHotelListingRequestDecisionEmail(
  request: Pick<HotelListingRequestEmailData, 'hotelName' | 'owner'>,
  reviewed: boolean,
  reason: string,
) {
  const contactEmail = process.env.PARTNER_ADMIN_EMAIL || 'waystayrooms@gmail.com'
  await sendEmail({
    from: FROM,
    to: request.owner.email,
    replyTo: contactEmail,
    subject: `Update on ${request.hotelName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#0f172a">
      <h1 style="color:#0a2540">Hotel listing request update</h1>
      <p>Hi ${escapeHtml(request.owner.name)},</p>
      <p>${reviewed
        ? `Waystay has reviewed your request to list <strong>${escapeHtml(request.hotelName)}</strong>. The administrator will contact you for any remaining hotel content and verification.`
        : `Waystay cannot proceed with the request to list <strong>${escapeHtml(request.hotelName)}</strong> at this time.`}</p>
      <p><strong>Admin note:</strong> ${escapeHtml(reason)}</p>
      <p>For assistance, reply to this email or contact <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>
    </div>`,
  })
}
