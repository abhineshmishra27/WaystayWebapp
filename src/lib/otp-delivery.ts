import { Resend } from 'resend'

type OtpPurpose = 'login' | 'register'

export interface OtpDeliveryResult {
  channel: 'email'
  delivered: boolean
  sentTo: string
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@')
  const visible = localPart.slice(0, Math.min(2, localPart.length))
  return `${visible}${'*'.repeat(Math.max(2, localPart.length - visible.length))}@${domain}`
}

function isLocalDemoMode() {
  return process.env.NODE_ENV !== 'production' && process.env.OTP_DEMO_MODE === 'true'
}

async function deliverEmailOtp(email: string, code: string, purpose: OtpPurpose): Promise<boolean> {
  if (isLocalDemoMode()) return false
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') throw new Error('Email OTP service is not configured')
    return false
  }

  const resend = new Resend(apiKey)
  const action = purpose === 'register' ? 'create your Waystay account' : 'sign in to Waystay'
  const { error } = await resend.emails.send({
    from: process.env.OTP_EMAIL_FROM || 'Waystay <noreply@waystay.co.in>',
    to: email,
    subject: `${code} is your Waystay verification code`,
    text: `Your Waystay verification code is ${code}. It expires in 10 minutes. Never share this code with anyone.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0f172a">
      <h1 style="font-size:22px;margin:0 0 12px">Verify your Waystay account</h1>
      <p style="color:#475569">Use this code to ${action}:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#ea580c">${code}</p>
      <p style="color:#64748b;font-size:13px">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    </div>`,
  })
  if (error) throw new Error(`Email OTP delivery failed: ${error.message}`)
  return true
}

export async function deliverOtp(identifier: string, code: string, purpose: OtpPurpose): Promise<OtpDeliveryResult> {
  if (!identifier.includes('@')) throw new Error('Mobile OTP is handled by Firebase Authentication')
  return {
    channel: 'email',
    delivered: await deliverEmailOtp(identifier, code, purpose),
    sentTo: maskEmail(identifier),
  }
}
