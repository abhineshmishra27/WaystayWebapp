'use client'

import { FormEvent, useEffect, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'

type PortalMode = 'signin' | 'signup'

const OWNER_DESTINATION = '/owner/hotels/new'

export default function PartnerPortalPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [mode, setMode] = useState<PortalMode>('signin')
  const [loading, setLoading] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (status === 'authenticated' && session.user.role === 'OWNER') {
      window.location.replace(OWNER_DESTINATION)
    }
  }, [router, session, status])

  async function handleSignOut() {
    setLoading(true)
    try {
      await signOut({ redirect: false })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!identifier.trim() || !password) {
      toast.error('Enter your email or mobile number and password.')
      return
    }

    setLoading(true)
    try {
      const result = await signIn('credentials', {
        identifier: identifier.trim(),
        password,
        requiredRole: 'OWNER',
        redirect: false,
        redirectTo: OWNER_DESTINATION,
      })

      if (!result?.ok || result.error || !result.url) {
        toast.error('Incorrect owner username or password.')
        return
      }

      window.location.replace(OWNER_DESTINATION)
    } catch {
      toast.error('Owner sign-in could not be completed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    const cleanPhone = phone.replace(/\D/g, '')

    if (name.trim().length < 2) return toast.error('Enter your full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return toast.error('Enter a valid email address.')
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) return toast.error('Enter a valid 10-digit mobile number.')
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return toast.error('Use an 8+ character password with an uppercase letter and number.')
    }
    if (password !== confirmPassword) return toast.error('Passwords do not match.')

    setLoading(true)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          phone: cleanPhone,
          password,
          role: 'OWNER',
        }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Owner account could not be created.')
      if (typeof data.registrationToken !== 'string') throw new Error('Account created, but automatic sign-in failed.')

      const result = await signIn('credentials', {
        registrationToken: data.registrationToken,
        requiredRole: 'OWNER',
        redirect: false,
        redirectTo: OWNER_DESTINATION,
      })

      if (!result?.ok || result.error || !result.url) {
        throw new Error('Account created, but automatic sign-in failed. Please sign in.')
      }

      window.location.replace(OWNER_DESTINATION)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Owner account could not be created.')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || (status === 'authenticated' && session.user.role === 'OWNER')) {
    return <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 text-sm text-slate-500">Opening the owner portal…</div>
  }

  if (status === 'authenticated') {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-slate-50 px-4 py-16">
        <Toaster />
        <section className="mx-auto max-w-lg rounded-2xl border border-orange-100 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-50 text-2xl" aria-hidden="true">🏨</span>
          <h1 className="mt-5 text-2xl font-bold text-slate-900">Waystay Owner Portal</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            You are currently signed in as a traveler. Sign out, then sign in with an owner account or create a new owner account.
          </p>
          <button type="button" onClick={handleSignOut} disabled={loading} className="mt-6 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50">
            {loading ? 'Signing out…' : 'Continue to owner sign in'}
          </button>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-800">Return to Waystay</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-65px)] bg-slate-50 px-4 py-10">
      <Toaster />
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-[0.9fr_1.1fr]">
        <section className="bg-slate-950 p-8 text-white md:p-12">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-400">Waystay for partners</p>
          <h1 className="mt-5 text-3xl font-bold leading-tight">List your hotel and start receiving bookings</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">Create and manage your property, rooms, photos, availability and guest bookings from one owner portal.</p>
          <ul className="mt-8 space-y-4 text-sm text-slate-200">
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Add hotel details and location</li>
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Upload photos and choose a main photo</li>
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Manage rooms, pricing and bookings</li>
          </ul>
        </section>

        <section className="p-6 sm:p-10 md:p-12">
          <div className="mb-7 flex rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setMode('signin')} className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Owner sign in</button>
            <button type="button" onClick={() => setMode('signup')} className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Create owner account</button>
          </div>

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Email or mobile number</label><input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
              <button disabled={loading} className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50">{loading ? 'Signing in…' : 'Sign in and add your hotel'}</button>
            </form>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Full name</label><input value={name} onChange={event => setName(event.target.value)} autoComplete="name" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Email address</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Mobile number</label><input type="tel" value={phone} onChange={event => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
              <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium text-slate-700">Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div><div><label className="mb-1 block text-sm font-medium text-slate-700">Confirm password</label><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div></div>
              <p className="text-xs text-slate-500">Use at least 8 characters with one uppercase letter and one number.</p>
              <button disabled={loading} className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50">{loading ? 'Creating owner account…' : 'Create account and add hotel'}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
