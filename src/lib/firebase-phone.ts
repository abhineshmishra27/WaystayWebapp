'use client'

import {
  ConfirmationResult,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth'
import { getFirebasePhoneAuth } from '@/lib/firebase-client'

export type FirebasePhoneChallenge = {
  confirmation: ConfirmationResult
  verifier: RecaptchaVerifier
}

export async function requestFirebasePhoneOtp(
  phone: string,
  recaptchaContainerId: string,
): Promise<FirebasePhoneChallenge> {
  const auth = getFirebasePhoneAuth()
  if (auth.currentUser) await signOut(auth)

  const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
    size: 'invisible',
  })

  try {
    const confirmation = await signInWithPhoneNumber(auth, `+91${phone}`, verifier)
    return { confirmation, verifier }
  } catch (error) {
    verifier.clear()
    throw error
  }
}

export async function confirmFirebasePhoneOtp(
  challenge: FirebasePhoneChallenge,
  code: string,
) {
  try {
    const credential = await challenge.confirmation.confirm(code)
    const idToken = await credential.user.getIdToken()
    await signOut(getFirebasePhoneAuth())
    return idToken
  } finally {
    challenge.verifier.clear()
  }
}

export function clearFirebasePhoneChallenge(challenge: FirebasePhoneChallenge | null) {
  challenge?.verifier.clear()
}

export function getFirebasePhoneError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : ''

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Enter a valid Indian mobile number.'
    case 'auth/invalid-verification-code':
      return 'Incorrect OTP. Check the code and try again.'
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This OTP has expired. Request a new code.'
    case 'auth/too-many-requests':
      return 'Too many OTP attempts. Please try again later.'
    case 'auth/quota-exceeded':
      return 'The SMS service quota has been reached. Please try again later.'
    case 'auth/operation-not-allowed':
      return 'Mobile OTP is not enabled for this Waystay environment.'
    case 'auth/billing-not-enabled':
      return 'Firebase billing must be enabled before real SMS can be sent.'
    case 'auth/captcha-check-failed':
    case 'auth/missing-client-identifier':
      return 'The security check failed. Refresh the page and try again.'
    default:
      return error instanceof Error ? error.message : 'Mobile OTP could not be completed.'
  }
}
