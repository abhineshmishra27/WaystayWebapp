'use client'
import { Suspense, useEffect, useState } from 'react'
import { getProviders, signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'

function getAuthRedirect(returnTo: string | null) {
  if (!returnTo || returnTo === '/' || returnTo === '/hotels' || returnTo.startsWith('/hotels?')) return '/'
  return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status } = useSession()
  const [method, setMethod] = useState<'password' | 'otp'>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
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
  const validIdentifier = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim()) || /^[6-9]\d{9}$/.test(identifier.trim())

  useEffect(() => {
    getProviders().then(providers => setGoogleEnabled(Boolean(providers?.google))).catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(redirectTo)
      router.refresh()
    }
  }, [redirectTo, router, status])

  const selectMethod = (next: 'password' | 'otp') => {
    setMethod(next)
    setOtpSent(false)
    setOtp('')
  }

  const sendOtp = async () => {
    if (!validIdentifier) return toast.error('Enter a valid email or 10-digit mobile number.')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, purpose: 'login' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOtpSent(true)
      setCooldown(30)
      if (data.demoOtp) toast.success(`Demo OTP: ${data.demoOtp}`, { duration: 10000 })
      const timer = window.setInterval(() => setCooldown(value => {
        if (value <= 1) { window.clearInterval(timer); return 0 }
        return value - 1
      }), 1000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send OTP.')
    } finally { setLoading(false) }
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSignInError('')
    if (!validIdentifier) return toast.error('Enter a valid email or 10-digit mobile number.')
    if (method === 'password' && !password) return toast.error('Enter your password.')
    if (method === 'otp' && !/^\d{6}$/.test(otp)) return toast.error('Enter the 6-digit OTP.')
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        identifier,
        password: method === 'password' ? password : undefined,
        otp: method === 'otp' ? otp : undefined,
        redirect: false,
        redirectTo,
      })
      if (!result?.ok || result.error || !result.url) {
        const message = method === 'otp' ? 'Incorrect or expired OTP.' : 'Incorrect username or password.'
        setSignInError(message)
        toast.error(message)
        return
      }
      router.replace(redirectTo)
      router.refresh()
    } catch {
      const message = 'Sign in could not be completed. Please try again.'
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
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-500">Taking you to Waystay…</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Toaster />
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
            <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="you@example.com or 9876543210" />
          </div>

          <div className="flex rounded-lg bg-gray-100 p-1 gap-1">
            <button type="button" onClick={() => selectMethod('password')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Password</button>
            <button type="button" onClick={() => selectMethod('otp')} className={`flex-1 py-2 rounded-md text-sm font-medium ${method === 'otp' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>OTP</button>
          </div>

          {method === 'password' && <div><label className="block text-sm font-medium text-gray-700 mb-1">Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••••" /></div>}
          {method === 'otp' && otpSent && <div><label className="block text-sm font-medium text-gray-700 mb-1">OTP</label><input autoFocus value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center tracking-[0.35em] text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••" /><p className="text-xs text-gray-500 mt-1">The OTP is sent to your registered email and mobile.</p></div>}

          {method === 'otp' && !otpSent ? <button type="button" onClick={sendOtp} disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">{loading ? 'Sending OTP...' : 'Send OTP'}</button> : <><button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">{loading ? (method === 'otp' ? 'Verifying...' : 'Signing in...') : method === 'otp' ? 'Verify OTP' : 'Sign in'}</button>{method === 'otp' && <button type="button" onClick={sendOtp} disabled={loading || cooldown > 0} className="w-full text-indigo-600 text-xs font-medium disabled:text-gray-400">{cooldown ? `Resend OTP (${cooldown}s)` : 'Resend OTP'}</button>}</>}
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">No account? <Link href={registerHref} className="text-indigo-600 hover:underline font-medium">Create one</Link></p>
      </div>
    </div>
  )
}

export default function LoginPage() { return <Suspense fallback={<div className="min-h-screen bg-gray-50" />}><LoginForm /></Suspense> }
