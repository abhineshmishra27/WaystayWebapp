'use client'

import { useState } from 'react'
import type { RoomSlotSettings } from '@/lib/room-slot-settings'

type SettingKey = keyof RoomSlotSettings

const OPTIONS: Array<{ key: SettingKey; label: string; description: string }> = [
  { key: 'threeHourEnabled', label: '3 hours', description: 'Short hourly stay' },
  { key: 'sixHourEnabled', label: '6 hours', description: 'Half-day stay' },
  { key: 'twelveHourEnabled', label: '12 hours', description: 'Extended hourly stay' },
  { key: 'nightStayEnabled', label: 'Night stay', description: 'Full-day booking' },
]

export default function RoomStayOptionControls({ roomId, initialSettings }: { roomId: string; initialSettings: RoomSlotSettings }) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState<SettingKey | null>(null)
  const [message, setMessage] = useState('')

  async function toggle(key: SettingKey) {
    const enabled = !settings[key]
    setSaving(key)
    setMessage('')
    try {
      const response = await fetch(`/api/owner/rooms/${roomId}/slot-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: enabled }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this stay option.')
      setSettings({
        threeHourEnabled: data.room.threeHourEnabled,
        sixHourEnabled: data.room.sixHourEnabled,
        twelveHourEnabled: data.room.twelveHourEnabled,
        nightStayEnabled: data.room.nightStayEnabled,
      })
      setMessage(`${OPTIONS.find(option => option.key === key)?.label} ${enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update this stay option.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map(option => {
          const enabled = settings[option.key]
          const isSaving = saving === option.key
          return (
            <button
              key={option.key}
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={saving !== null}
              onClick={() => toggle(option.key)}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${enabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
            >
              <span><span className="block text-sm font-semibold text-gray-800">{option.label}</span><span className="block text-[11px] text-gray-500">{option.description}</span></span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-gray-300'}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
              <span className="sr-only">{isSaving ? 'Saving' : enabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 min-h-4 text-xs text-gray-500" aria-live="polite">{saving ? 'Saving stay-option availability…' : message}</p>
    </div>
  )
}
