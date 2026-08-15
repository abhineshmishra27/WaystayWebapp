'use client'

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

type HotelPhoto = { id: string; url: string; caption: string | null }

export default function HotelPhotoManager({ hotelId, hotelName, initialPhotos }: { hotelId: string; hotelName: string; initialPhotos: HotelPhoto[] }) {
  const router = useRouter()
  const [photos, setPhotos] = useState(initialPhotos)
  const [savingId, setSavingId] = useState<string | null>(null)

  async function setMainPhoto(photo: HotelPhoto) {
    if (photos[0]?.id === photo.id) return
    if (!window.confirm(`Use this photo as the main listing photo for ${hotelName}?`)) return
    const reason = window.prompt('Reason for changing the main hotel photo:')
    if (reason === null) return
    if (reason.trim().length < 5) return toast.error('Enter a reason of at least 5 characters.')
    setSavingId(photo.id)
    try {
      const response = await fetch(`/api/admin/hotels/${hotelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mainPhotoId: photo.id, reason: reason.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to change the main photo.')
      setPhotos(current => [photo, ...current.filter(item => item.id !== photo.id)])
      toast.success('Main hotel photo updated')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to change the main photo.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5">
      <Toaster />
      <div className="flex items-center justify-between"><div><h2 className="font-semibold text-gray-900">Hotel photos</h2><p className="mt-1 text-xs text-gray-500">Select the photo displayed first in search and hotel listings.</p></div><span className="text-xs text-gray-500">{photos.length} uploaded</span></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{photos.map((photo, index) => <figure key={photo.id} className={`overflow-hidden rounded-xl border ${index === 0 ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-100'}`}><img src={photo.url} alt={photo.caption || `${hotelName} photo ${index + 1}`} className="h-48 w-full object-cover" /><figcaption className="flex items-center justify-between gap-2 p-3 text-xs text-gray-500"><span>{photo.caption || `Photo ${index + 1}`}</span>{index === 0 ? <span className="font-semibold text-indigo-600">MAIN PHOTO</span> : <button type="button" disabled={savingId !== null} onClick={() => setMainPhoto(photo)} className="font-semibold text-indigo-600 hover:underline disabled:opacity-40">Set as main</button>}</figcaption></figure>)}{photos.length === 0 && <p className="text-sm text-red-600">No hotel photos uploaded.</p>}</div>
    </section>
  )
}
