'use client'

import { FormEvent, useEffect, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import Link from 'next/link'
import toast, { Toaster } from 'react-hot-toast'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

const OWNER_DESTINATION = '/owner/hotels/new'

export default function PartnerPortalPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const hasOwnerAccess = hasPermission(session?.user.role, PERMISSIONS.OWNER_ACCESS)

  useEffect(() => {
    if (status === 'authenticated' && hasOwnerAccess) {
      window.location.replace(OWNER_DESTINATION)
    }
  }, [hasOwnerAccess, status])

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
        toast.error('Incorrect credentials, or owner access has not been assigned.')
        return
      }
      window.location.replace(OWNER_DESTINATION)
    } catch {
      toast.error('Owner sign-in could not be completed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || (status === 'authenticated' && hasOwnerAccess)) {
    return <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 text-sm text-slate-500">Opening the owner portal…</div>
  }

  if (status === 'authenticated') {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-slate-50 px-4 py-16">
        <section className="mx-auto max-w-lg rounded-2xl border border-orange-100 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-50 text-2xl" aria-hidden="true">🏨</span>
          <h1 className="mt-5 text-2xl font-bold text-slate-900">Hotel owner access required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your account is currently a customer account. A Waystay administrator must assign the Hotel Owner role before you can open the onboarding portal.
          </p>
          <Link href="/dashboard/profile" className="mt-6 inline-flex w-full justify-center rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700">View your account</Link>
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
          <h1 className="mt-5 text-3xl font-bold leading-tight">Manage your hotel and guest bookings</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">Owner access is provided by a Waystay administrator after your property and account are verified.</p>
          <ul className="mt-8 space-y-4 text-sm text-slate-200">
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Add hotel details and location</li>
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Upload photos and choose a main photo</li>
            <li className="flex gap-3"><span className="text-orange-400">✓</span> Manage rooms, pricing and bookings</li>
          </ul>
        </section>

        <section className="p-6 sm:p-10 md:p-12">
          <h2 className="text-2xl font-bold text-slate-900">Owner sign in</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Use the account that Waystay approved for hotel owner access.</p>
          <form onSubmit={handleSignIn} className="mt-7 space-y-4">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Email or mobile number</label><input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></div>
            <button disabled={loading} className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50">{loading ? 'Signing in…' : 'Sign in to owner portal'}</button>
          </form>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
            Need a customer account first? <Link href="/register" className="font-semibold text-orange-600 hover:underline">Create an account</Link>, then contact Waystay to have owner access assigned.
          </div>
        </section>
      </div>
    </main>
  )
}
