'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'
import { getAuthRedirect } from '@/lib/auth-redirect'
import {
  clearFirebasePhoneChallenge,
  confirmFirebasePhoneOtp,
  FirebasePhoneChallenge,
  getFirebasePhoneError,
  requestFirebasePhoneOtp,
} from '@/lib/firebase-phone'

type Method = 'password' | 'otp'

function RegisterForm() {
  const params = useSearchParams()
  const { status } = useSession()
  const firebaseChallenge = useRef<FirebasePhoneChallenge | null>(null)
  const [method, setMethod] = useState<Method>('password')
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' })
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [otpDestination, setOtpDestination] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const requestedReturnTo = params.get('returnTo')
  const redirectTo = requestedReturnTo ? getAuthRedirect(requestedReturnTo) : '/'
  const update = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }))
  const validDetails = form.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && /^[6-9]\d{9}$/.test(form.phone)
  const validPassword = form.password.length >= 8 && /[A-Z]/.test(form.password) && /[0-9]/.test(form.password) && form.password === form.confirmPassword

  useEffect(() => {
    if (status === 'authenticated') window.location.replace(redirectTo)
  }, [redirectTo, status])

  useEffect(() => () => clearFirebasePhoneChallenge(firebaseChallenge.current), [])

  const resetOtp = () => {
    clearFirebasePhoneChallenge(firebaseChallenge.current)
    firebaseChallenge.current = null
    setSent(false)
    setOtp('')
    setOtpDestination('')
  }

  const startCooldown = () => {
    setCooldown(30)
    const timer = window.setInterval(() => setCooldown(value => {
      if (value <= 1) {
        window.clearInterval(timer)
        return 0
      }
      return value - 1
    }), 1000)
  }

  const sendOtp = async () => {
    if (!validDetails) return toast.error('Complete your name, email, and mobile number first.')
    setLoading(true)
    try {
      resetOtp()
      const response = await fetch('/api/auth/firebase/phone/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: form.phone,
          email: form.email.trim().toLowerCase(),
          purpose: 'register',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)

      firebaseChallenge.current = await requestFirebasePhoneOtp(
        form.phone,
        'register-firebase-recaptcha',
      )
      setSent(true)
      setOtpDestination(`******${form.phone.slice(-4)}`)
      startCooldown()
      toast.success('OTP has been sent')
    } catch (error) {
      toast.error(getFirebasePhoneError(error))
    } finally {
      setLoading(false)
    }
  }

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validDetails) return toast.error('Complete your name, email, and mobile number first.')
    if (method === 'password' && !validPassword) return toast.error('Use an 8+ character password with an uppercase letter and number.')
    if (method === 'otp' && !/^\d{6}$/.test(otp)) return toast.error('Enter the 6-digit OTP.')

    setLoading(true)
    try {
      let firebaseIdToken: string | undefined
      if (method === 'otp') {
        if (!firebaseChallenge.current) throw new Error('Request a new mobile OTP first.')
        firebaseIdToken = await confirmFirebasePhoneOtp(firebaseChallenge.current, otp)
        firebaseChallenge.current = null
      }

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          ...(method === 'password' ? { password: form.password } : { firebaseIdToken }),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Registration failed')
      if (typeof data.registrationToken !== 'string') throw new Error('Account created, but automatic sign-in could not be started.')

      const result = await signIn('credentials', {
        registrationToken: data.registrationToken,
        redirect: false,
        redirectTo,
      })
      if (!result?.ok || result.error || !result.url) {
        throw new Error('Account created, but automatic sign-in failed. Please use the sign-in page.')
      }
      window.location.replace(redirectTo)
    } catch (error) {
      toast.error(method === 'otp' ? getFirebasePhoneError(error) : error instanceof Error ? error.message : 'Unable to create account.')
    } finally {
      setLoading(false)
    }
  }

  const chooseMethod = (next: Method) => {
    setMethod(next)
    resetOtp()
  }

  if (status === 'loading' || status === 'authenticated') {
    return <div className="min-h-screen flex flex-col gap-3 items-center justify-center bg-gray-50 text-sm text-gray-500"><p>Taking you to Waystay…</p>{status === 'authenticated' && <a href={redirectTo} className="font-semibold text-indigo-600 hover:underline">Continue to Waystay</a>}</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <Toaster />
      <div id="register-firebase-recaptcha" />
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Create account</h1>
        <p className="text-gray-500 text-sm mb-6">Join WayStayy today</p>
        <form onSubmit={createAccount} className="space-y-4">
          <div className="flex rounded-lg bg-gray-100 p-1 gap-1">
            <button type="button" onClick={() => chooseMethod('password')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Password</button>
            <button type="button" onClick={() => chooseMethod('otp')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'otp' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Mobile OTP</button>
          </div>
          <p className="text-xs text-gray-500">{method === 'password' ? 'Create an account with a password.' : 'Firebase will send a one-time code to your mobile.'}</p>
          {([['name', 'Full name', 'text'], ['email', 'Email address', 'email'], ['phone', '10-digit mobile number', 'tel']] as const).map(([key, placeholder, type]) => (
            <input key={key} type={type} value={form[key]} onChange={event => { update(key, key === 'phone' ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value); if (sent) resetOtp() }} placeholder={placeholder} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          ))}
          {method === 'password' && <><input type="password" value={form.password} onChange={event => update('password', event.target.value)} placeholder="Create password (min 8 characters)" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /><input type="password" value={form.confirmPassword} onChange={event => update('confirmPassword', event.target.value)} placeholder="Confirm password" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /></>}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">New accounts are created as customer accounts. Hotel owner access is assigned by a Waystay administrator.</p>
          {method === 'otp' && sent && <><p className="text-xs text-green-700">Code sent to {otpDestination}.</p><input autoFocus value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="Enter 6-digit OTP" className="w-full text-center tracking-[0.35em] text-lg border border-gray-200 rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" /><div className="flex justify-between text-xs"><button type="button" onClick={resetOtp} className="text-gray-500 font-medium">Change details</button><button type="button" onClick={sendOtp} disabled={loading || cooldown > 0} className="text-indigo-600 font-medium disabled:text-gray-400">{cooldown ? `Resend OTP (${cooldown}s)` : 'Resend OTP'}</button></div></>}
          {method === 'otp' && !sent
            ? <button type="button" onClick={sendOtp} disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Sending OTP...' : 'Send OTP'}</button>
            : <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Creating account...' : method === 'otp' ? 'Verify & Create Account' : 'Create account'}</button>}
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">Already have an account? <Link href={`/login?returnTo=${encodeURIComponent(redirectTo)}`} className="text-indigo-600 hover:underline font-medium">Sign in</Link></p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return <Suspense fallback={<div className="min-h-screen bg-gray-50" />}><RegisterForm /></Suspense>
}
