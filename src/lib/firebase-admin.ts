import 'server-only'

import { normalizePhone } from '@/lib/otp'

type FirebaseTokenPayload = {
  firebase?: { sign_in_provider?: string }
}

type FirebaseAccountLookup = {
  users?: Array<{
    localId?: string
    phoneNumber?: string
  }>
}

function readTokenPayload(idToken: string): FirebaseTokenPayload {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('The Firebase ID token is malformed')

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FirebaseTokenPayload
  } catch {
    throw new Error('The Firebase ID token is malformed')
  }
}

export async function verifyFirebasePhoneIdToken(idToken: string) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  if (!apiKey) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is required')

  // Firebase validates the token before returning the associated account.
  // Using the Identity Toolkit endpoint here avoids loading firebase-admin in
  // every Auth.js request, which is incompatible with the current Vercel runtime.
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    throw new Error('Firebase could not verify this phone sign-in')
  }

  const data = await response.json() as FirebaseAccountLookup
  const account = data.users?.[0]
  const provider = readTokenPayload(idToken).firebase?.sign_in_provider
  if (provider !== 'phone' || !account?.localId || !account.phoneNumber) {
    throw new Error('A Firebase phone-auth token is required')
  }

  const phone = normalizePhone(account.phoneNumber)
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error('The verified phone number is not a valid Indian mobile number')
  }

  return { uid: account.localId, phone }
}
