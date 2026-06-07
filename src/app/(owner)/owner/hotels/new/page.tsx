'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast, { Toaster } from 'react-hot-toast'

const AMENITIES = ['WiFi', 'Parking', 'Pool', 'Gym', 'Restaurant', 'AC', 'TV', 'Laundry', 'Room Service', '24hr Reception']
const TIMES = ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00']

const schema = z.object({
  name: z.string().min(3),
  description: z.string().min(20),
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  country: z.string().default('India'),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
})

type FormInput = z.input<typeof schema>
type FormData = z.output<typeof schema>

export default function NewHotelPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [amenities, setAmenities] = useState<string[]>([])
  const [images, setImages] = useState<{ url: string; publicId: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(schema),
    defaultValues: { country: 'India', checkInTime: '12:00', checkOutTime: '11:00' },
  })

  const detectLocation = () => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        setValue('lat', pos.coords.latitude)
        setValue('lng', pos.coords.longitude)
        toast.success('Location detected')
      },
      () => toast.error('Could not detect location')
    )
  }

  const handleImageUpload = async (files: FileList) => {
    setUploading(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'hotels')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (res.ok) {
        const data = await res.json()
        setImages(prev => [...prev, { url: data.url, publicId: data.publicId }])
      }
    }
    setUploading(false)
  }

  const onSubmit = async (data: FormData) => {
    if (images.length === 0) {
      toast.error('Add at least one photo')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/hotels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, amenities, imageUrls: images }),
    })
    if (res.ok) {
      toast.success('Hotel submitted for admin approval!')
      router.push('/owner/hotels')
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to create hotel')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Toaster />
      <div className="flex items-center gap-3 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{s}</div>
            {s < 3 && <div className={`w-16 h-0.5 ${step > s ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
        <span className="text-sm text-gray-500 ml-2">
          {step === 1 ? 'Basic info' : step === 2 ? 'Location & amenities' : 'Photos'}
        </span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Basic information</h2>
            {([
              { name: 'name', label: 'Hotel name', placeholder: 'The Grand Bangalore', textarea: false },
              { name: 'description', label: 'Description', placeholder: 'Describe your property...', textarea: true },
            ] as const).map(f => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                {f.textarea ? (
                  <textarea
                    {...register(f.name)}
                    rows={4}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <input
                    {...register(f.name)}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
                {errors[f.name] && (
                  <p className="text-red-500 text-xs mt-1">{errors[f.name]?.message}</p>
                )}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check-in time</label>
                <select
                  {...register('checkInTime')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white"
                >
                  {TIMES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check-out time</label>
                <select
                  {...register('checkOutTime')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white"
                >
                  {TIMES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              Next: Location
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Location & amenities</h2>
            {(['address', 'city', 'state'] as const).map(field => (
              <div key={field}>
                <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{field}</label>
                <input
                  {...register(field)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
                />
                {errors[field] && (
                  <p className="text-red-500 text-xs mt-1">{errors[field]?.message}</p>
                )}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  {...register('lat')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  {...register('lng')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={detectLocation}
              className="text-sm text-indigo-600 hover:underline"
            >
              📍 Detect my location
            </button>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Amenities</label>
              <div className="grid grid-cols-2 gap-2">
                {AMENITIES.map(a => (
                  <label key={a} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={amenities.includes(a)}
                      onChange={e => setAmenities(prev => e.target.checked ? [...prev, a] : prev.filter(x => x !== a))}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{a}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg text-sm"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                Next: Photos
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Hotel photos</h2>
            <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors">
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files && handleImageUpload(e.target.files)}
              />
              <p className="text-gray-500 text-sm">{uploading ? 'Uploading...' : 'Click to upload photos (max 5MB each)'}</p>
            </label>
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="Hotel" className="w-full h-24 object-cover rounded-lg" />
                    <button
                      type="button"
                      onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-red-500 text-white w-5 h-5 rounded-full text-xs hidden group-hover:flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg text-sm"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || uploading}
                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit for approval'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
