'use client'

import { useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'

export default function OwnerHotelStatusButton({ hotelId, hotelName, initialEnabled, adminActive }: { hotelId: string; hotelName: string; initialEnabled: boolean; adminActive: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const nextEnabled = !enabled
    if (!window.confirm(`${nextEnabled ? 'Enable' : 'Disable'} ${hotelName} on Waystay?`)) return
    setSaving(true)
    try {
      const response = await fetch(`/api/owner/hotels/${hotelId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this listing.')
      setEnabled(data.hotel.ownerEnabled)
      toast.success(data.hotel.ownerEnabled ? 'Hotel enabled on Waystay' : 'Hotel disabled on Waystay')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this listing.')
    } finally {
      setSaving(false)
    }
  }

  return <><Toaster /><button type="button" onClick={toggle} disabled={saving || (!adminActive && !enabled)} className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-green-600 text-white hover:bg-green-700'}`}>{saving ? 'Updating…' : enabled ? 'Disable listing' : adminActive ? 'Enable listing' : 'Suspended by admin'}</button></>
}
