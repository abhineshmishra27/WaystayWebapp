'use client'

import Link from 'next/link'
import { FormEvent, type ReactNode, useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'

const emptyRequest = {
  hotelName: '', gstNumber: '', licenseNumber: '', address: '', city: '', state: '',
  pincode: '', contactPhone: '', roomCount: '', message: '', website: '',
}

export default function HotelListingRequestForm({ initialPhone = '' }: { initialPhone?: string }) {
  const [details, setDetails] = useState({ ...emptyRequest, contactPhone: initialPhone })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function update(field: keyof typeof emptyRequest, value: string) {
    setDetails(current => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await fetch('/api/owner/hotel-listing-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(details),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The listing request could not be submitted.')
      setSubmitted(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The listing request could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-green-100 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-2xl font-bold text-green-700" aria-hidden="true">✓</span>
        <h1 className="mt-5 text-2xl font-semibold text-gray-900">Hotel request submitted</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">Thank you. The Waystay administrator has been notified and will contact you after reviewing the property details.</p>
        <p className="mt-2 text-xs text-gray-500">Submitting a request does not publish the hotel. Waystay administration will verify and create the listing.</p>
        <Link href="/owner/hotels" className="mt-6 inline-flex rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">Return to my properties</Link>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
      <Toaster />
      <div className="border-b border-gray-100 pb-5">
        <h1 className="text-2xl font-semibold text-gray-900">List another hotel</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">Share the basic details of your additional property. The Waystay administrator will verify them and contact you for rooms, prices and photos.</p>
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Hotel name"><input required value={details.hotelName} onChange={event => update('hotelName', event.target.value)} autoComplete="organization" className={inputClass} /></Field>
        <Field label="GST number"><input required value={details.gstNumber} onChange={event => update('gstNumber', event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15))} className={`${inputClass} font-mono uppercase`} placeholder="22AAAAA0000A1Z5" /></Field>
        <Field label="Hotel licence number" optional><input value={details.licenseNumber} onChange={event => update('licenseNumber', event.target.value)} maxLength={100} className={inputClass} /></Field>
        <Field label="Contact mobile number"><input required value={details.contactPhone} onChange={event => update('contactPhone', event.target.value.replace(/[^0-9+\s-]/g, ''))} inputMode="tel" autoComplete="tel" className={inputClass} placeholder="10-digit Indian mobile number" /></Field>
        <div className="sm:col-span-2"><Field label="Complete hotel address"><textarea required rows={3} value={details.address} onChange={event => update('address', event.target.value)} maxLength={300} className={inputClass} /></Field></div>
        <Field label="City"><input required value={details.city} onChange={event => update('city', event.target.value)} autoComplete="address-level2" className={inputClass} /></Field>
        <Field label="State"><input required value={details.state} onChange={event => update('state', event.target.value)} autoComplete="address-level1" className={inputClass} /></Field>
        <Field label="PIN code"><input required value={details.pincode} onChange={event => update('pincode', event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="postal-code" className={inputClass} /></Field>
        <Field label="Approximate room count" optional><input type="number" min="1" max="10000" value={details.roomCount} onChange={event => update('roomCount', event.target.value)} className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Additional information" optional><textarea rows={4} value={details.message} onChange={event => update('message', event.target.value)} maxLength={2000} className={inputClass} placeholder="Property category, star rating, amenities or the best time to contact you" /></Field></div>
        <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={details.website} onChange={event => update('website', event.target.value)} /></label></div>
        <p className="text-xs leading-5 text-gray-500 sm:col-span-2">Only Waystay administrators can create and publish hotel content. You can enable or disable the listing after it is assigned and approved.</p>
        <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
          <Link href="/owner/hotels" className="rounded-lg border border-gray-200 px-5 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</Link>
          <button disabled={submitting} className="rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit hotel for review'}</button>
        </div>
      </form>
    </section>
  )
}

const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100'

function Field({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return <label className="block"><span className="mb-1 flex items-center justify-between text-sm font-medium text-gray-700"><span>{label}</span>{optional && <span className="text-xs font-normal text-gray-400">Optional</span>}</span>{children}</label>
}
