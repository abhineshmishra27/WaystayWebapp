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

export default function RoomStayOptionControls({
  roomId,
  initialSettings,
  initialInventoryCount,
}: {
  roomId: string
  initialSettings: RoomSlotSettings
  initialInventoryCount: number
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [inventoryCount, setInventoryCount] = useState(initialInventoryCount)
  const [inventoryDraft, setInventoryDraft] = useState(String(initialInventoryCount))
  const [saving, setSaving] = useState<SettingKey | 'inventoryCount' | null>(null)
  const [message, setMessage] = useState('')

  function applyResponse(data: { room: RoomSlotSettings & { inventoryCount: number } }) {
    setSettings({
      threeHourEnabled: data.room.threeHourEnabled,
      sixHourEnabled: data.room.sixHourEnabled,
      twelveHourEnabled: data.room.twelveHourEnabled,
      nightStayEnabled: data.room.nightStayEnabled,
    })
    setInventoryCount(data.room.inventoryCount)
    setInventoryDraft(String(data.room.inventoryCount))
  }

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
      applyResponse(data)
      setMessage(`${OPTIONS.find(option => option.key === key)?.label} ${enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update this stay option.')
    } finally {
      setSaving(null)
    }
  }

  async function updateInventory() {
    const nextInventory = parseInt(inventoryDraft, 10)
    if (!Number.isInteger(nextInventory) || nextInventory < 1 || nextInventory > 100) {
      setMessage('Room inventory must be between 1 and 100.')
      return
    }

    setSaving('inventoryCount')
    setMessage('')
    try {
      const response = await fetch(`/api/owner/rooms/${roomId}/slot-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryCount: nextInventory }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update room inventory.')
      applyResponse(data)
      setMessage(`Inventory updated to ${nextInventory} room${nextInventory === 1 ? '' : 's'}.`)
    } catch (error) {
      setInventoryDraft(String(inventoryCount))
      setMessage(error instanceof Error ? error.message : 'Unable to update room inventory.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
        <div>
          <label htmlFor={`inventory-${roomId}`} className="block text-sm font-semibold text-gray-800">Rooms in this category</label>
          <p className="mt-0.5 text-[11px] text-gray-500">Bookings consume this shared room inventory only while their times overlap.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id={`inventory-${roomId}`}
            type="number"
            min={1}
            max={100}
            value={inventoryDraft}
            disabled={saving !== null}
            onChange={event => setInventoryDraft(event.target.value)}
            className="w-20 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={saving !== null || inventoryDraft === String(inventoryCount)}
            onClick={updateInventory}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving === 'inventoryCount' ? 'Saving…' : 'Update'}
          </button>
        </div>
      </div>
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
      <p className="mt-2 min-h-4 text-xs text-gray-500" aria-live="polite">{saving ? 'Saving room settings…' : message}</p>
    </div>
  )
}
