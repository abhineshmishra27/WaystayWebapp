'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

export default function ReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const bookingId = params.id
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [hotelId, setHotelId] = useState('')
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!loaded) {
    fetch(`/api/bookings`).then(r => r.json()).then((bookings: { id: string; roomSlot: { room: { hotel: { id: string } } } }[]) => {
      const b = bookings.find((b) => b.id === bookingId)
      if (b) setHotelId(b.roomSlot?.room?.hotel?.id || '')
      setLoaded(true)
    })
  }

  const handleImageUpload = async (files: FileList) => {
    if (mediaUrls.length >= 5) { toast.error('Max 5 photos'); return }
    setUploading(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'reviews')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (res.ok) {
        const data = await res.json()
        setMediaUrls(prev => [...prev, data.url])
      }
    }
    setUploading(false)
  }

  const handleSubmit = async () => {
    if (rating === 0) { toast.error('Please select a rating'); return }
    if (title.length < 5) { toast.error('Title is too short'); return }
    if (body.length < 20) { toast.error('Review is too short (min 20 characters)'); return }
    if (!hotelId) { toast.error('Could not find hotel information'); return }

    setSubmitting(true)
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, hotelId, rating, title, body, mediaUrls }),
    })

    if (res.ok) {
      toast.success('Review submitted! Thank you.')
      setTimeout(() => router.push('/dashboard/bookings'), 1000)
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to submit review')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold text-gray-900 mb-8">Write a review</h1>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-3">Overall rating</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(s => (
              <button key={s} type="button"
                onMouseEnter={() => setHoverRating(s)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(s)}
                className={`text-3xl transition-transform hover:scale-110 ${s <= (hoverRating || rating) ? 'text-yellow-400' : 'text-gray-200'}`}>
                ★
              </button>
            ))}
          </div>
          {rating > 0 && <p className="text-sm text-gray-400 mt-2">{['', 'Terrible', 'Poor', 'Average', 'Good', 'Excellent'][rating]}</p>}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
              placeholder="Summarise your experience"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your review</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} maxLength={2000}
              placeholder="Tell other guests about your experience..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <p className="text-xs text-gray-400 text-right mt-1">{body.length}/2000</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">Add photos (optional, max 5)</label>
          <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400">
            <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleImageUpload(e.target.files)} />
            <p className="text-sm text-gray-400">{uploading ? 'Uploading...' : 'Click to upload photos'}</p>
          </label>
          {mediaUrls.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-3">
              {mediaUrls.map((url, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg" />
                  <button onClick={() => setMediaUrls(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 text-white w-4 h-4 rounded-full text-xs flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleSubmit} disabled={submitting || uploading}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50">
          {submitting ? 'Submitting...' : 'Submit review'}
        </button>
      </div>
    </div>
  )
}
