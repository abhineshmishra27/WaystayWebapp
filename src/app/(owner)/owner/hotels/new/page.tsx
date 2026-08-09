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
type UploadedHotelImage = { url: string; publicId: string }

export default function NewHotelPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [amenities, setAmenities] = useState<string[]>([])
  const [images, setImages] = useState<UploadedHotelImage[]>([])
  const [mainPhotoPublicId, setMainPhotoPublicId] = useState<string | null>(null)
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
    const uploadedImages: UploadedHotelImage[] = []

    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('folder', 'hotels')
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (res.ok) {
          const data = await res.json()
          uploadedImages.push({ url: data.url, publicId: data.publicId })
        } else {
          toast.error(`Could not upload ${file.name}`)
        }
      }

      if (uploadedImages.length > 0) {
        setImages(prev => [...prev, ...uploadedImages])
        setMainPhotoPublicId(prev => prev ?? uploadedImages[0].publicId)
      }
    } finally {
      setUploading(false)
    }
  }

  const removeImage = (publicId: string) => {
    const remainingImages = images.filter(image => image.publicId !== publicId)
    setImages(remainingImages)
    setMainPhotoPublicId(current => current === publicId ? remainingImages[0]?.publicId ?? null : current)
  }

  const onSubmit = async (data: FormData) => {
    if (images.length === 0) {
      toast.error('Add at least one photo')
      return
    }
    if (!mainPhotoPublicId || !images.some(image => image.publicId === mainPhotoPublicId)) {
      toast.error('Choose the main hotel photo')
      return
    }

    const orderedImages = [
      ...images.filter(image => image.publicId === mainPhotoPublicId),
      ...images.filter(image => image.publicId !== mainPhotoPublicId),
    ]

    setSubmitting(true)
    const res = await fetch('/api/hotels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, amenities, imageUrls: orderedImages }),
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
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-800">Uploaded photos</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Choose one photo as the main image shown in hotel listings.</p>
                </div>
                {images.map((img, i) => {
                  const isMain = img.publicId === mainPhotoPublicId
                  return (
                  <div key={img.publicId} className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${isMain ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="radio"
                        name="mainHotelPhoto"
                        checked={isMain}
                        onChange={() => setMainPhotoPublicId(img.publicId)}
                        className="h-4 w-4 shrink-0 accent-indigo-600"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={`Hotel upload ${i + 1}`} className="h-20 w-28 shrink-0 rounded-lg object-cover" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-800">Photo {i + 1}</span>
                        <span className="block text-xs text-gray-500">{isMain ? 'Main hotel photo' : 'Select as main photo'}</span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeImage(img.publicId)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                  )
                })}
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
