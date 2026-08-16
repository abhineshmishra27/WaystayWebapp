'use client'

/* eslint-disable @next/next/no-img-element */

import { FormEvent, type ReactNode, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

type OwnerOption = { id: string; name: string; email: string }
type UploadedImage = { url: string; publicId: string }

const initialForm = {
  ownerId: '', name: '', description: '', address: '', city: '', state: '', country: 'India', pincode: '',
  lat: '', lng: '', checkInTime: '12:00', checkOutTime: '11:00', license_number: '', gst_number: '', rating_avg: '0', amenities: '',
}

export default function AdminHotelCreateForm({ owners }: { owners: OwnerOption[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ ...initialForm, ownerId: owners[0]?.id || '' })
  const [images, setImages] = useState<UploadedImage[]>([])
  const [mainPhotoId, setMainPhotoId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function update(field: keyof typeof initialForm, value: string) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function uploadPhotos(files: FileList) {
    setUploading(true)
    try {
      const uploaded: UploadedImage[] = []
      for (const file of Array.from(files)) {
        const body = new FormData()
        body.append('file', file)
        body.append('folder', 'hotels')
        const response = await fetch('/api/upload', { method: 'POST', body })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `Could not upload ${file.name}.`)
        uploaded.push({ url: data.url, publicId: data.publicId })
      }
      setImages(current => [...current, ...uploaded])
      setMainPhotoId(current => current || uploaded[0]?.publicId || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Photo upload failed.')
    } finally {
      setUploading(false)
    }
  }

  function removePhoto(publicId: string) {
    setImages(current => {
      const remaining = current.filter(image => image.publicId !== publicId)
      setMainPhotoId(selected => selected === publicId ? remaining[0]?.publicId || null : selected)
      return remaining
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.ownerId) return toast.error('Approve or select an owner before creating the hotel.')
    if (images.length === 0 || !mainPhotoId) return toast.error('Upload at least one photo and select the main photo.')
    const imageUrls = [
      ...images.filter(image => image.publicId === mainPhotoId),
      ...images.filter(image => image.publicId !== mainPhotoId),
    ]
    setSubmitting(true)
    try {
      const response = await fetch('/api/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lat: Number(form.lat),
          lng: Number(form.lng),
          rating_avg: Number(form.rating_avg),
          gst_number: form.gst_number.toUpperCase(),
          amenities: form.amenities.split(',').map(value => value.trim()).filter(Boolean),
          imageUrls,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Hotel could not be created.')
      toast.success('Hotel draft created')
      router.push(`/admin/hotels/${data.id}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hotel could not be created.')
      setSubmitting(false)
    }
  }

  if (owners.length === 0) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Approve a partner application first. A hotel must be assigned to an active OWNER or ADMIN account.</div>
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Toaster />
      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Ownership and identity</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AdminField label="Assigned owner"><select value={form.ownerId} onChange={event => update('ownerId', event.target.value)} required className={inputClass}>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name} · {owner.email}</option>)}</select></AdminField>
          <AdminField label="Hotel name"><input value={form.name} onChange={event => update('name', event.target.value)} required minLength={3} className={inputClass} /></AdminField>
          <AdminField label="GST number"><input value={form.gst_number} onChange={event => update('gst_number', event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15))} required className={`${inputClass} font-mono uppercase`} /></AdminField>
          <AdminField label="Hotel licence number"><input value={form.license_number} onChange={event => update('license_number', event.target.value)} required className={inputClass} /></AdminField>
          <div className="sm:col-span-2"><AdminField label="Description"><textarea rows={5} value={form.description} onChange={event => update('description', event.target.value)} required minLength={20} className={inputClass} /></AdminField></div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Address and location</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><AdminField label="Street address"><input value={form.address} onChange={event => update('address', event.target.value)} required className={inputClass} /></AdminField></div>
          <AdminField label="City"><input value={form.city} onChange={event => update('city', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="State"><input value={form.state} onChange={event => update('state', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Country"><input value={form.country} onChange={event => update('country', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Pincode"><input value={form.pincode} onChange={event => update('pincode', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Latitude"><input type="number" step="any" value={form.lat} onChange={event => update('lat', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Longitude"><input type="number" step="any" value={form.lng} onChange={event => update('lng', event.target.value)} required className={inputClass} /></AdminField>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Stay information</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AdminField label="Check-in time"><input type="time" value={form.checkInTime} onChange={event => update('checkInTime', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Check-out time"><input type="time" value={form.checkOutTime} onChange={event => update('checkOutTime', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Star rating"><input type="number" min="0" max="5" step="0.1" value={form.rating_avg} onChange={event => update('rating_avg', event.target.value)} required className={inputClass} /></AdminField>
          <AdminField label="Amenities" hint="Comma-separated"><input value={form.amenities} onChange={event => update('amenities', event.target.value)} className={inputClass} placeholder="WiFi, Parking, Restaurant" /></AdminField>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <div><h2 className="font-semibold text-gray-900">Hotel photos</h2><p className="mt-1 text-xs text-gray-500">Upload all supplied photos and select the main listing image.</p></div>
        <label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-gray-200 p-8 text-center text-sm text-gray-500 hover:border-indigo-400"><input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => event.target.files && uploadPhotos(event.target.files)} />{uploading ? 'Uploading photos…' : 'Choose hotel photos'}</label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{images.map((image, index) => <div key={image.publicId} className={`flex items-center gap-3 rounded-xl border p-3 ${mainPhotoId === image.publicId ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}><label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"><input type="radio" name="mainPhoto" checked={mainPhotoId === image.publicId} onChange={() => setMainPhotoId(image.publicId)} /><img src={image.url} alt={`Hotel upload ${index + 1}`} className="h-16 w-24 rounded-lg object-cover" /><span className="text-xs font-semibold text-gray-700">{mainPhotoId === image.publicId ? 'Main photo' : `Photo ${index + 1}`}</span></label><button type="button" onClick={() => removePhoto(image.publicId)} className="text-xs font-semibold text-red-600">Remove</button></div>)}</div>
      </section>

      <div className="flex justify-end"><button disabled={submitting || uploading} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{submitting ? 'Creating hotel…' : 'Create hotel draft'}</button></div>
    </form>
  )
}

const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'

function AdminField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}</label>
}
