import 'server-only'

import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { normalizePhone } from '@/lib/otp'

function getFirebaseAdminAuth() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required')

  const app = getApps().length ? getApps()[0] : initializeApp({ projectId })
  return getAuth(app)
}

export async function verifyFirebasePhoneIdToken(idToken: string) {
  const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken)
  const provider = decoded.firebase?.sign_in_provider
  if (provider !== 'phone' || !decoded.phone_number) {
    throw new Error('A Firebase phone-auth token is required')
  }

  const phone = normalizePhone(decoded.phone_number)
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error('The verified phone number is not a valid Indian mobile number')
  }

  return { uid: decoded.uid, phone }
}
