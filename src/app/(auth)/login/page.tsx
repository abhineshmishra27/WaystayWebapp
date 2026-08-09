'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { getProviders, signIn, useSession } from 'next-auth/react'
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

function LoginForm() {
  const searchParams = useSearchParams()
  const { status } = useSession()
  const firebaseChallenge = useRef<FirebasePhoneChallenge | null>(null)
  const [method, setMethod] = useState<'password' | 'otp'>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpDestination, setOtpDestination] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [signInError, setSignInError] = useState('')

  const registered = searchParams.get('registered') === 'true' || searchParams.has('registered')
  const unauthorized = searchParams.get('error') === 'unauthorized'
  const authError = searchParams.get('error')
  const returnTo = searchParams.get('returnTo')
  const redirectTo = getAuthRedirect(returnTo)
  const registerHref = returnTo ? `/register?returnTo=${encodeURIComponent(redirectTo)}` : '/register'
  const normalizedIdentifier = identifier.trim().toLowerCase()
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentifier)
  const isPhone = /^[6-9]\d{9}$/.test(normalizedIdentifier)
  const validIdentifier = isEmail || isPhone

  useEffect(() => {
    getProviders().then(providers => setGoogleEnabled(Boolean(providers?.google))).catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    if (status === 'authenticated') window.location.replace(redirectTo)
  }, [redirectTo, status])

  useEffect(() => () => clearFirebasePhoneChallenge(firebaseChallenge.current), [])

  const resetOtp = () => {
    clearFirebasePhoneChallenge(firebaseChallenge.current)
    firebaseChallenge.current = null
    setOtpSent(false)
    setOtp('')
    setOtpDestination('')
  }

  const selectMethod = (next: 'password' | 'otp') => {
    setMethod(next)
    resetOtp()
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
    if (!validIdentifier) return toast.error('Enter a valid email or 10-digit mobile number.')
    setLoading(true)
    setSignInError('')
    try {
      resetOtp()
      if (isPhone) {
        const preflight = await fetch('/api/auth/firebase/phone/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: normalizedIdentifier, purpose: 'login' }),
        })
        const preflightData = await preflight.json()
        if (!preflight.ok) throw new Error(preflightData.error)

        firebaseChallenge.current = await requestFirebasePhoneOtp(
          normalizedIdentifier,
          'login-firebase-recaptcha',
        )
        setOtpDestination(`******${normalizedIdentifier.slice(-4)}`)
        toast.success('SMS OTP sent by Firebase.')
      } else {
        const response = await fetch('/api/auth/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: normalizedIdentifier, purpose: 'login' }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setOtpDestination(data.sentTo || 'your email')
        toast.success(data.demoOtp ? `Demo OTP: ${data.demoOtp}` : data.message, {
          duration: data.demoOtp ? 10000 : 4000,
        })
      }
      setOtpSent(true)
      startCooldown()
    } catch (error) {
      toast.error(isPhone ? getFirebasePhoneError(error) : error instanceof Error ? error.message : 'Could not send OTP.')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSignInError('')
    if (!validIdentifier) return toast.error('Enter a valid email or 10-digit mobile number.')
    if (method === 'password' && !password) return toast.error('Enter your password.')
    if (method === 'otp' && !/^\d{6}$/.test(otp)) return toast.error('Enter the 6-digit OTP.')

    setLoading(true)
    try {
      let firebaseIdToken: string | undefined
      if (method === 'otp' && isPhone) {
        if (!firebaseChallenge.current) throw new Error('Request a new mobile OTP first.')
        firebaseIdToken = await confirmFirebasePhoneOtp(firebaseChallenge.current, otp)
        firebaseChallenge.current = null
      }

      const result = await signIn('credentials', {
        identifier: normalizedIdentifier,
        password: method === 'password' ? password : undefined,
        otp: method === 'otp' && isEmail ? otp : undefined,
        firebaseIdToken,
        redirect: false,
        redirectTo,
      })
      if (!result?.ok || result.error || !result.url) {
        const message = method === 'otp' ? 'Incorrect or expired OTP.' : 'Incorrect username or password.'
        setSignInError(message)
        toast.error(message)
        return
      }
      window.location.replace(redirectTo)
    } catch (error) {
      const message = method === 'otp' && isPhone
        ? getFirebasePhoneError(error)
        : 'Sign in could not be completed. Please try again.'
      setSignInError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    await signIn('google', { redirectTo })
  }

  if (status === 'loading' || status === 'authenticated') {
    return <div className="min-h-screen flex flex-col gap-3 items-center justify-center bg-gray-50 text-sm text-gray-500"><p>Taking you to Waystay…</p>{status === 'authenticated' && <a href={redirectTo} className="font-semibold text-indigo-600 hover:underline">Continue to Waystay</a>}</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Toaster />
      <div id="login-firebase-recaptcha" />
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Welcome back</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to your WayStayy account</p>

        {registered && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 mb-4">Account created! You can now sign in.</div>}
        {unauthorized && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">You do not have permission to access that page.</div>}
        {authError && authError !== 'unauthorized' && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">Google sign-in could not be completed. Please try again.</div>}
        {signInError && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{signInError}</div>}

        {googleEnabled && <>
          <button type="button" onClick={handleGoogleSignIn} disabled={googleLoading || loading} className="w-full border border-gray-200 bg-white text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-4V7.4H3.2a10 10 0 0 0 0 9.2L6.5 14Z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 3.2 7.4L6.5 10A5.8 5.8 0 0 1 12 6Z" /></svg>
            {googleLoading ? 'Connecting to Google...' : 'Continue with Google'}
          </button>
          <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-gray-200" /><span className="text-xs uppercase tracking-wide text-gray-400">or</span><div className="h-px flex-1 bg-gray-200" /></div>
        </>}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email or mobile number</label>
            <input type="text" value={identifier} onChange={event => { setIdentifier(event.target.value); if (otpSent) resetOtp() }} autoComplete="username" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="you@example.com or 9876543210" />
          </div>

          <div className="flex rounded-lg bg-gray-100 p-1 gap-1">
            <button type="button" onClick={() => selectMethod('password')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Password</button>
            <button type="button" onClick={() => selectMethod('otp')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'otp' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>OTP</button>
          </div>

          {method === 'password' && <div><label className="block text-sm font-medium text-gray-700 mb-1">Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••••" /></div>}
          {method === 'otp' && otpSent && <div><label className="block text-sm font-medium text-gray-700 mb-1">OTP</label><input autoFocus value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center tracking-[0.35em] text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••" /><p className="text-xs text-gray-500 mt-1">Code sent to {otpDestination}.</p></div>}

          {method === 'otp' && !otpSent
            ? <button type="button" onClick={sendOtp} disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">{loading ? 'Sending OTP...' : 'Send OTP'}</button>
            : <><button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">{loading ? (method === 'otp' ? 'Verifying...' : 'Signing in...') : method === 'otp' ? 'Verify OTP' : 'Sign in'}</button>{method === 'otp' && <button type="button" onClick={sendOtp} disabled={loading || cooldown > 0} className="w-full text-indigo-600 text-xs font-medium disabled:text-gray-400">{cooldown ? `Resend OTP (${cooldown}s)` : 'Resend OTP'}</button>}</>}
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">No account? <Link href={registerHref} className="text-indigo-600 hover:underline font-medium">Create one</Link></p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense fallback={<div className="min-h-screen bg-gray-50" />}><LoginForm /></Suspense>
}
