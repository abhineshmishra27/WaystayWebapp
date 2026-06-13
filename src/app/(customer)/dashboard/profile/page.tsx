'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import toast, { Toaster } from 'react-hot-toast'

interface ProfileUser {
  id: string
  name: string
  email: string
  phone: string | null
  role: 'ADMIN' | 'OWNER' | 'CUSTOMER'
  avatarUrl: string | null
  createdAt: string
  _count?: {
    bookings: number
    reviews: number
    hotels: number
  }
}

type FieldErrors = Partial<Record<'name' | 'phone' | 'avatarUrl', string[]>>

export default function ProfilePage() {
  const { update } = useSession()
  const [user, setUser] = useState<ProfileUser | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetch('/api/profile')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load profile')
        return data.user as ProfileUser
      })
      .then((profile) => {
        setUser(profile)
        setName(profile.name)
        setPhone(profile.phone || '')
        setAvatarUrl(profile.avatarUrl || '')
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [])

  const initials = useMemo(() => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'W'
  }, [name])

  const joinedDate = user?.createdAt
    ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(user.createdAt))
    : ''

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', 'avatars')

    setUploading(true)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload image')
      setAvatarUrl(data.url)
      toast.success('Avatar uploaded')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload image')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setFieldErrors({})

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, avatarUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFieldErrors(data.details || {})
        throw new Error(data.error || 'Failed to update profile')
      }

      setUser((current) => current ? { ...current, ...data.user } : data.user)
      await update({ user: { name: data.user.name, avatarUrl: data.user.avatarUrl } })
      toast.success('Profile updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <p className="text-sm text-gray-400">Loading profile...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
          <div>
            <p className="text-sm text-indigo-600 font-medium mb-2">Account settings</p>
            <h1 className="text-2xl font-semibold text-gray-900">My profile</h1>
            <p className="text-gray-500 mt-2">Keep your WayStayy booking details ready for faster checkouts.</p>
          </div>
          <Link href="/dashboard/bookings" className="text-sm text-indigo-600 hover:underline">View bookings</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <aside className="bg-white border border-gray-100 rounded-2xl p-6 h-fit">
            <div className="flex flex-col items-center text-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={name} className="w-24 h-24 rounded-full object-cover border border-gray-100" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-2xl font-semibold">
                  {initials}
                </div>
              )}
              <h2 className="font-semibold text-gray-900 mt-4">{name || user?.name}</h2>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <span className="mt-3 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{user?.role}</span>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-6 text-center">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-lg font-semibold text-gray-900">{user?._count?.bookings ?? 0}</p>
                <p className="text-xs text-gray-400">Bookings</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-lg font-semibold text-gray-900">{user?._count?.reviews ?? 0}</p>
                <p className="text-xs text-gray-400">Reviews</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-lg font-semibold text-gray-900">{user?._count?.hotels ?? 0}</p>
                <p className="text-xs text-gray-400">Hotels</p>
              </div>
            </div>

            {joinedDate && <p className="text-xs text-gray-400 text-center mt-5">Member since {joinedDate}</p>}
          </aside>

          <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-gray-900">Personal information</h2>
              <p className="text-sm text-gray-500 mt-1">These details are used when you reserve a room.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {fieldErrors.name && <p className="text-red-500 text-xs mt-1">{fieldErrors.name[0]}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Mobile number"
                />
                {fieldErrors.phone && <p className="text-red-500 text-xs mt-1">{fieldErrors.phone[0]}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                value={user?.email || ''}
                disabled
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Avatar URL</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://..."
                />
                <label className="inline-flex items-center justify-center border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                  {uploading ? 'Uploading...' : 'Upload'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarUpload} disabled={uploading} />
                </label>
              </div>
              {fieldErrors.avatarUrl && <p className="text-red-500 text-xs mt-1">{fieldErrors.avatarUrl[0]}</p>}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-2">
              <Link href="/hotels" className="text-center border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                Browse hotels
              </Link>
              <button
                type="submit"
                disabled={saving || uploading}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save profile'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
