'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const SLOT_LABELS: Record<string, string> = { H3: '3 Hours', H6: '6 Hours', H12: '12 Hours', FULLDAY: 'Full Day' }
type SlotType = 'H3' | 'H6' | 'H12' | 'FULLDAY'
const DEFAULT_MAX_GUESTS_PER_ROOM = 3

function daysInRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function getTodayDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function clampToToday(date: string | undefined, today: string) {
  return date && date >= today ? date : today
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

interface SlotOption {
  id: string
  startTime: string
  endTime: string
  isBooked: boolean
  slotType: string
}

export default function SlotPicker({
  roomId,
  price3h,
  price6h,
  price12h,
  priceFullDay,
  hotelId,
  maxGuestsPerRoom = DEFAULT_MAX_GUESTS_PER_ROOM,
  initialSlotType = 'H3',
  initialStartDate,
  initialEndDate,
  initialGuestCount,
  initialRoomCount,
}: {
  roomId: string
  price3h: number
  price6h: number
  price12h: number
  priceFullDay: number
  hotelId: string
  maxGuestsPerRoom?: number
  initialSlotType?: SlotType
  initialStartDate?: string
  initialEndDate?: string
  initialGuestCount?: string
  initialRoomCount?: string
}) {
  const router = useRouter()
  const today = getTodayDateString()
  const initialSafeStartDate = clampToToday(initialStartDate, today)
  const initialSafeEndDate = clampToToday(initialEndDate || initialStartDate, today)
  const [startDate, setStartDate] = useState(initialSafeStartDate)
  const [endDate, setEndDate] = useState(initialSafeEndDate >= initialSafeStartDate ? initialSafeEndDate : initialSafeStartDate)
  const [activeTab, setActiveTab] = useState<SlotType>(initialSlotType)
  const [availability, setAvailability] = useState<Record<string, SlotOption[]>>({})
  const [loading, setLoading] = useState(false)
  const guestsPerRoomLimit = Math.max(1, Math.min(maxGuestsPerRoom, DEFAULT_MAX_GUESTS_PER_ROOM))
  const [guestCount, setGuestCount] = useState(positiveInt(initialGuestCount, 1))
  const [roomCount, setRoomCount] = useState(Math.max(positiveInt(initialRoomCount, 1), Math.ceil(positiveInt(initialGuestCount, 1) / guestsPerRoomLimit)))
  const requiredRooms = Math.max(1, Math.ceil(guestCount / guestsPerRoomLimit))

  useEffect(() => {
    let cancelled = false

    async function fetchAvailability() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ startDate, endDate: activeTab === 'FULLDAY' ? endDate : startDate })
        const res = await fetch(`/api/rooms/${roomId}/availability?${params.toString()}`)
        const data = await res.json()
        if (!cancelled) {
          setAvailability(data.availability ?? {})
        }
      } catch {
        // silently ignore — slot picker shows empty state
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAvailability()

    return () => {
      cancelled = true
    }
  }, [activeTab, endDate, roomId, startDate])

  const currentSlots = availability?.[startDate] ?? []
  const filteredSlots = currentSlots.filter(slot => slot.slotType === activeTab)

  const getPrice = (slotType: string) => {
    const basePrice = slotType === 'FULLDAY'
      ? priceFullDay * daysInRange(startDate, endDate)
      : slotType === 'H3'
        ? price3h
        : slotType === 'H6'
          ? price6h
          : price12h

    return basePrice * roomCount
  }

  const updateGuestCount = (nextGuests: number) => {
    const safeGuests = Math.max(1, Math.min(30, nextGuests))
    const nextRequiredRooms = Math.max(1, Math.ceil(safeGuests / guestsPerRoomLimit))
    setGuestCount(safeGuests)
    setRoomCount(prev => Math.max(prev, nextRequiredRooms))
  }

  const updateRoomCount = (nextRooms: number) => {
    setRoomCount(Math.max(requiredRooms, Math.min(10, nextRooms)))
  }

  const handleSlotSelect = (slot: SlotOption) => {
    const params = new URLSearchParams({
      slotId: slot.id,
      roomId,
      hotelId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      date: startDate,
      startDate,
      endDate: activeTab === 'FULLDAY' ? endDate : startDate,
      slotType: activeTab,
      price: getPrice(activeTab).toString(),
      guestCount: guestCount.toString(),
      roomCount: roomCount.toString(),
      maxGuestsPerRoom: guestsPerRoomLimit.toString(),
    })
    const bookingUrl = `/booking?${params.toString()}`

    router.push(bookingUrl)
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-gray-600">Start:</label>
        <input
          type="date"
          value={startDate}
          min={today}
          onChange={e => {
            setStartDate(e.target.value)
            if (endDate < e.target.value) setEndDate(e.target.value)
          }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        />
        <label className="text-sm text-gray-600">End:</label>
        <input
          type="date"
          value={endDate}
          min={startDate}
          onChange={e => setEndDate(e.target.value)}
          disabled={activeTab !== 'FULLDAY'}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="text-sm text-gray-600">
          <span className="block mb-1">Guests</span>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-2 py-1.5">
            <button type="button" onClick={() => updateGuestCount(guestCount - 1)} className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50" aria-label="Decrease guests">-</button>
            <span className="font-medium text-gray-800">{guestCount}</span>
            <button type="button" onClick={() => updateGuestCount(guestCount + 1)} className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50" aria-label="Increase guests">+</button>
          </div>
        </div>
        <div className="text-sm text-gray-600">
          <span className="block mb-1">Rooms</span>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-2 py-1.5">
            <button type="button" onClick={() => updateRoomCount(roomCount - 1)} disabled={roomCount <= requiredRooms} className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40" aria-label="Decrease rooms">-</button>
            <span className="font-medium text-gray-800">{roomCount}</span>
            <button type="button" onClick={() => updateRoomCount(roomCount + 1)} className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50" aria-label="Increase rooms">+</button>
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <span className="block font-medium text-gray-700">Max {guestsPerRoomLimit} guests per room</span>
          {requiredRooms > 1 ? `${guestCount} guests need at least ${requiredRooms} rooms.` : 'One room is enough for this group.'}
        </div>
      </div>

      <div className="flex gap-1 mb-4 bg-gray-50 p-1 rounded-xl">
        {(['H3', 'H6', 'H12', 'FULLDAY'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setActiveTab(t)
              if (t !== 'FULLDAY') setEndDate(startDate)
            }}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors ${activeTab === t ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {SLOT_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 w-28 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filteredSlots.map(slot => (
            <button
              key={slot.id}
              type="button"
              disabled={slot.isBooked}
              onClick={() => handleSlotSelect(slot)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${slot.isBooked ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'}`}
            >
              {slot.startTime} – {slot.endTime}
              {!slot.isBooked && <span className="block text-xs text-indigo-500">₹{getPrice(activeTab)}</span>}
            </button>
          ))}
          {!loading && filteredSlots.length === 0 && (
            <p className="text-sm text-gray-400">No {SLOT_LABELS[activeTab]} slots for this date</p>
          )}
        </div>
      )}
    </div>
  )
}
