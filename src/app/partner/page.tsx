'use client'

import { FormEvent, type ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import toast, { Toaster } from 'react-hot-toast'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

const OWNER_DESTINATION = '/owner/hotels'

const emptyApplication = {
  fullName: '', businessName: '', email: '', phone: '', password: '', gstNumber: '',
  city: '', state: '', propertyCount: '1', message: '', website: '',
}

export default function PartnerPortalPage() {
  const { data: session, status } = useSession()
  const [application, setApplication] = useState(emptyApplication)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const hasOwnerAccess = hasPermission(session?.user.role, PERMISSIONS.OWNER_ACCESS)

  useEffect(() => {
    if (status === 'authenticated' && hasOwnerAccess) window.location.replace(OWNER_DESTINATION)
  }, [hasOwnerAccess, status])

  useEffect(() => {
    if (session?.user) {
      setApplication(current => ({
        ...current,
        fullName: current.fullName || session.user.name || '',
        email: current.email || session.user.email || '',
      }))
    }
  }, [session])

  function updateApplication(field: keyof typeof emptyApplication, value: string) {
    setApplication(current => ({ ...current, [field]: value }))
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await fetch('/api/partner-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...application, propertyCount: Number(application.propertyCount) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Your application could not be submitted.')
      setSubmitted(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your application could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading' || (status === 'authenticated' && hasOwnerAccess)) {
    return <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 text-sm text-slate-500">Opening the owner portal…</div>
  }

  if (submitted) {
    return (
      <main className="min-h-[calc(100vh-65px)] bg-slate-50 px-4 py-16">
        <section className="mx-auto max-w-xl rounded-3xl border border-green-100 bg-white p-8 text-center shadow-sm sm:p-12">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-3xl text-green-700" aria-hidden="true">✓</span>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">Application received</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">Thank you for sharing your details, admin will get back to you soon.</p>
          <p className="mt-4 text-sm leading-6 text-slate-500">Your hotel-owner account will remain pending until a Waystay administrator verifies and approves it.</p>
          <Link href="/" className="mt-7 inline-flex rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700">Return to Waystay</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-65px)] bg-slate-50 px-4 py-10">
      <Toaster />
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl lg:grid lg:grid-cols-[0.78fr_1.22fr]">
        <section className="bg-[#0a2540] p-8 text-white lg:p-12">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-400">Waystay for partners</p>
          <h1 className="mt-5 text-3xl font-bold leading-tight">Bring your property to Waystay</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">Share your business details to begin verification. An administrator will contact you for complete hotel information.</p>
          <ol className="mt-8 space-y-5 text-sm text-slate-200">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold">1</span><span>Submit owner and GST information.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold">2</span><span>Waystay verifies and approves the owner account.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold">3</span><span>Send property content to the admin for listing.</span></li>
          </ol>
        </section>

        <section className="p-6 sm:p-10 lg:p-12">
          <h2 className="text-2xl font-bold text-slate-900">Hotel-owner application</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">All fields marked required are used for owner verification. Your password is encrypted and never sent by email.</p>
          <form onSubmit={submitApplication} className="mt-7 grid gap-4 sm:grid-cols-2">
                <Field label="Owner full name"><input value={application.fullName} onChange={event => updateApplication('fullName', event.target.value)} autoComplete="name" required className={inputClass} /></Field>
                <Field label="Business or hotel name"><input value={application.businessName} onChange={event => updateApplication('businessName', event.target.value)} autoComplete="organization" required className={inputClass} /></Field>
                <Field label="Email address"><input type="email" value={application.email} onChange={event => updateApplication('email', event.target.value)} autoComplete="email" required className={inputClass} /></Field>
                <Field label="Mobile number"><input value={application.phone} onChange={event => updateApplication('phone', event.target.value.replace(/[^0-9+\s-]/g, ''))} inputMode="tel" autoComplete="tel" required className={inputClass} placeholder="10-digit Indian mobile number" /></Field>
                <Field label="Create password" hint="8+ characters with an uppercase letter and number"><input type="password" value={application.password} onChange={event => updateApplication('password', event.target.value)} autoComplete="new-password" minLength={8} required className={inputClass} /></Field>
                <Field label="GST number"><input value={application.gstNumber} onChange={event => updateApplication('gstNumber', event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15))} autoCapitalize="characters" required className={`${inputClass} font-mono uppercase`} placeholder="22AAAAA0000A1Z5" /></Field>
                <Field label="Hotel city"><input value={application.city} onChange={event => updateApplication('city', event.target.value)} required className={inputClass} /></Field>
                <Field label="State"><input value={application.state} onChange={event => updateApplication('state', event.target.value)} required className={inputClass} /></Field>
                <Field label="Number of properties"><input type="number" min="1" max="100" value={application.propertyCount} onChange={event => updateApplication('propertyCount', event.target.value)} required className={inputClass} /></Field>
                <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={application.website} onChange={event => updateApplication('website', event.target.value)} /></label></div>
                <div className="sm:col-span-2"><Field label="Anything else we should know?" optional><textarea rows={4} value={application.message} onChange={event => updateApplication('message', event.target.value)} maxLength={2000} className={inputClass} placeholder="Property type, locations or the best time to contact you" /></Field></div>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Submitting this form does not publish a hotel or grant owner access. Waystay will verify the application before approval.</p>
                <button disabled={submitting} className="rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50 sm:col-span-2">{submitting ? 'Submitting application…' : 'Submit partner application'}</button>
          </form>
        </section>
      </div>
    </main>
  )
}

const inputClass = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100'

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return <label className="block"><span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700"><span>{label}</span>{optional && <span className="text-xs font-normal text-slate-400">Optional</span>}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}</label>
}
