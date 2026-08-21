'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const HOUR_SLOT_OPTIONS = [
  { value: 'H3', label: '3 Hours' },
  { value: 'H6', label: '6 Hours' },
  { value: 'H12', label: '12 Hours' },
] as const

type SlotValue = 'H3' | 'H6' | 'H12' | 'FULLDAY'
type RentalMode = 'hourly' | 'day'
const MAX_GUESTS_PER_ROOM = 3

function normalizeSlot(slot?: string): SlotValue {
  return slot === 'H6' || slot === 'H12' || slot === 'FULLDAY' ? slot : 'H3'
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function SearchBar({
  className = '',
  initialCity = '',
  initialStartDate,
  initialEndDate,
  initialSlot,
  initialGuestCount,
  initialRoomCount,
  initialLat,
  initialLng,
  initialRadius,
}: {
  className?: string
  initialCity?: string
  initialStartDate?: string
  initialEndDate?: string
  initialSlot?: string
  initialGuestCount?: string
  initialRoomCount?: string
  initialLat?: string
  initialLng?: string
  initialRadius?: string
}) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const hasInitialLocation = Boolean(initialLat && initialLng)
  const [city, setCity] = useState(initialCity)
  const [startDate, setStartDate] = useState(initialStartDate || today)
  const [endDate, setEndDate] = useState(initialEndDate || initialStartDate || today)
  const [slot, setSlot] = useState<SlotValue>(normalizeSlot(initialSlot))
  const [guestCount, setGuestCount] = useState(positiveInt(initialGuestCount, 1))
  const [roomCount, setRoomCount] = useState(Math.max(positiveInt(initialRoomCount, 1), Math.ceil(positiveInt(initialGuestCount, 1) / MAX_GUESTS_PER_ROOM)))
  const rentalMode: RentalMode = slot === 'FULLDAY' ? 'day' : 'hourly'
  const requiredRooms = Math.max(1, Math.ceil(guestCount / MAX_GUESTS_PER_ROOM))

  const updateGuestCount = (nextGuests: number) => {
    const safeGuests = Math.max(1, Math.min(30, nextGuests))
    setGuestCount(safeGuests)
    setRoomCount(prev => Math.max(prev, Math.ceil(safeGuests / MAX_GUESTS_PER_ROOM)))
  }

  const updateRoomCount = (nextRooms: number) => {
    setRoomCount(Math.max(requiredRooms, Math.min(10, nextRooms)))
  }

  const handleSearch = (next?: Partial<{ city: string; startDate: string; endDate: string; slot: SlotValue }>) => {
    const nextCity = next?.city ?? city
    const nextStartDate = next?.startDate ?? startDate
    const nextEndDate = next?.endDate ?? endDate
    const nextSlot = next?.slot ?? slot
    const trimmedCity = nextCity.trim()

    const params = new URLSearchParams({
      startDate: nextStartDate,
      endDate: nextSlot === 'FULLDAY' ? nextEndDate : nextStartDate,
      slot: nextSlot,
      guestCount: guestCount.toString(),
      roomCount: roomCount.toString(),
    })
    if (trimmedCity) {
      params.set('city', trimmedCity)
    } else if (hasInitialLocation && initialLat && initialLng) {
      params.set('lat', initialLat)
      params.set('lng', initialLng)
      params.set('radius', initialRadius || '50')
      params.set('nearMe', '1')
    } else {
      return
    }
    router.push('/hotels?' + params.toString())
  }

  const updateRentalMode = (mode: RentalMode) => {
    if (mode === 'day') {
      const nextEndDate = endDate <= startDate ? addDays(startDate, 1) : endDate
      setSlot('FULLDAY')
      setEndDate(nextEndDate)
      return
    }

    const nextSlot = slot === 'FULLDAY' ? 'H3' : slot
    setSlot(nextSlot)
    setEndDate(startDate)
  }

  const updateHourSlot = (nextSlot: SlotValue) => {
    if (nextSlot === 'FULLDAY') return
    setSlot(nextSlot)
    setEndDate(startDate)
  }

  return (
    <div className={`bg-white rounded-2xl p-2 shadow-lg ${className}`}>
      <input
        type="text"
        placeholder={hasInitialLocation ? 'Searching near your current location' : 'City or area (e.g. Bangalore)'}
        value={city}
        onChange={e => setCity(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSearch()}
        className="w-full px-4 py-3 text-gray-800 text-sm focus:outline-none rounded-xl"
      />
      <div className="mt-2 flex flex-col gap-2 md:flex-row md:flex-wrap">
        <div className="grid grid-cols-2 gap-2 md:w-[23rem] md:shrink-0">
          <label className="rounded-xl border border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-3 py-2">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--waystay-orange-dark)]">Date</span>
            <input
              type="date"
              aria-label="Start date"
              value={startDate}
              min={today}
              onChange={e => {
                const nextStartDate = e.target.value
                setStartDate(nextStartDate)
                if (rentalMode === 'day' && endDate <= nextStartDate) setEndDate(addDays(nextStartDate, 1))
              }}
              className="mt-0.5 w-full bg-transparent text-sm font-semibold text-[var(--waystay-blue)] outline-none"
            />
          </label>
          <label className="rounded-xl border border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-3 py-2">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--waystay-orange-dark)]">{rentalMode === 'hourly' ? 'Hourly slot' : 'To date'}</span>
            {rentalMode === 'hourly' ? (
              <select
                value={slot}
                onChange={e => updateHourSlot(normalizeSlot(e.target.value))}
                className="mt-0.5 w-full bg-transparent text-sm font-semibold text-[var(--waystay-blue)] outline-none"
              >
                {HOUR_SLOT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                aria-label="To date"
                value={endDate}
                min={addDays(startDate, 1)}
                onChange={e => setEndDate(e.target.value)}
                className="mt-0.5 w-full bg-transparent text-sm font-semibold text-[var(--waystay-blue)] outline-none"
              />
            )}
          </label>
        </div>
        <div className="grid grid-cols-2 rounded-xl border border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] p-1">
          <button
            type="button"
            onClick={() => updateRentalMode('hourly')}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${rentalMode === 'hourly' ? 'bg-[var(--waystay-blue)] text-white shadow-sm' : 'text-[var(--waystay-blue)] hover:bg-white'}`}
          >
            Click for Hourly Stays
          </button>
          <button
            type="button"
            onClick={() => updateRentalMode('day')}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${rentalMode === 'day' ? 'bg-[var(--waystay-orange)] text-white shadow-sm' : 'text-[var(--waystay-blue)] hover:bg-white'}`}
          >
            Click for Night Halt
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-gray-800 text-sm rounded-xl border border-gray-100 bg-white min-w-44">
          <span className="text-gray-500">Guests</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount - 1)}
              className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
              aria-label="Decrease guests"
            >
              -
            </button>
            <span className="w-5 text-center font-medium">{guestCount}</span>
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount + 1)}
              className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
              aria-label="Increase guests"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-gray-800 text-sm rounded-xl border border-gray-100 bg-white min-w-44">
          <span className="text-gray-500">Rooms</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateRoomCount(roomCount - 1)}
              className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Decrease rooms"
              disabled={roomCount <= requiredRooms}
            >
              -
            </button>
            <span className="w-5 text-center font-medium">{roomCount}</span>
            <button
              type="button"
              onClick={() => updateRoomCount(roomCount + 1)}
              className="h-7 w-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
              aria-label="Increase rooms"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleSearch()}
          className="bg-[var(--waystay-orange)] text-white px-8 py-3 rounded-xl text-sm font-bold hover:bg-[var(--waystay-orange-dark)] transition-colors whitespace-nowrap"
        >
          Search hotels
        </button>
      </div>
    </div>
  )
}
