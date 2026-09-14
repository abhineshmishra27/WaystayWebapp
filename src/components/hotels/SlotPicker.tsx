'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { slotIsPastForBooking } from '@/lib/booking-time'

const SLOT_LABELS: Record<string, string> = { H3: '3 Hours', H6: '6 Hours', H12: '12 Hours', FULLDAY: 'Full Day' }
const SLOT_TABS = ['H3', 'H6', 'H12', 'FULLDAY'] as const
type SlotType = 'H3' | 'H6' | 'H12' | 'FULLDAY'
const DEFAULT_MAX_GUESTS_PER_ROOM = 3

function nightsInRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000))
}

function getTodayDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
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
  date: string
  startTime: string
  endTime: string
  isBooked: boolean
  hasStarted?: boolean
  isEnabled?: boolean
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
  inventoryCount = 1,
  initialSlotType = 'H3',
  initialStartDate,
  initialEndDate,
  initialGuestCount,
  initialRoomCount,
  threeHourEnabled = true,
  sixHourEnabled = true,
  twelveHourEnabled = true,
  nightStayEnabled = true,
}: {
  roomId: string
  price3h: number
  price6h: number
  price12h: number
  priceFullDay: number
  hotelId: string
  maxGuestsPerRoom?: number
  inventoryCount?: number
  initialSlotType?: SlotType
  initialStartDate?: string
  initialEndDate?: string
  initialGuestCount?: string
  initialRoomCount?: string
  threeHourEnabled?: boolean
  sixHourEnabled?: boolean
  twelveHourEnabled?: boolean
  nightStayEnabled?: boolean
}) {
  const router = useRouter()
  const enabledTabs: Record<SlotType, boolean> = {
    H3: threeHourEnabled,
    H6: sixHourEnabled,
    H12: twelveHourEnabled,
    FULLDAY: nightStayEnabled,
  }
  const firstEnabledTab = (Object.keys(enabledTabs) as SlotType[]).find(tab => enabledTabs[tab])
  const initialActiveTab = enabledTabs[initialSlotType] ? initialSlotType : firstEnabledTab ?? initialSlotType
  const today = getTodayDateString()
  const initialSafeStartDate = clampToToday(initialStartDate, today)
  const initialSafeEndDate = clampToToday(initialEndDate || initialStartDate, today)
  const [startDate, setStartDate] = useState(initialSafeStartDate)
  const [endDate, setEndDate] = useState(
    initialActiveTab === 'FULLDAY'
      ? initialSafeEndDate > initialSafeStartDate ? initialSafeEndDate : addDays(initialSafeStartDate, 1)
      : initialSafeStartDate,
  )
  const [activeTab, setActiveTab] = useState<SlotType>(initialActiveTab)
  const [availability, setAvailability] = useState<Record<string, SlotOption[]>>({})
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const guestsPerRoomLimit = Math.max(1, Math.min(maxGuestsPerRoom, DEFAULT_MAX_GUESTS_PER_ROOM))
  const roomSelectionLimit = Math.max(1, Math.min(10, inventoryCount))
  const [guestCount, setGuestCount] = useState(positiveInt(initialGuestCount, 1))
  const [roomCount, setRoomCount] = useState(Math.min(
    roomSelectionLimit,
    Math.max(positiveInt(initialRoomCount, 1), Math.ceil(positiveInt(initialGuestCount, 1) / guestsPerRoomLimit)),
  ))
  const requiredRooms = Math.max(1, Math.ceil(guestCount / guestsPerRoomLimit))

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchAvailability() {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          startDate,
          endDate: activeTab === 'FULLDAY' ? endDate : startDate,
          roomCount: roomCount.toString(),
        })
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
  }, [activeTab, endDate, roomCount, roomId, startDate])

  const currentSlots = availability?.[startDate] ?? []
  const filteredSlots = currentSlots.filter(slot => slot.slotType === activeTab)

  const getPrice = (slotType: string) => {
    const basePrice = slotType === 'FULLDAY'
      ? priceFullDay * nightsInRange(startDate, endDate)
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
    setRoomCount(prev => Math.min(roomSelectionLimit, Math.max(prev, nextRequiredRooms)))
  }

  const updateRoomCount = (nextRooms: number) => {
    setRoomCount(Math.max(requiredRooms, Math.min(roomSelectionLimit, nextRooms)))
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
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="rounded-xl border-2 border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-3 py-1.5 transition focus-within:border-[var(--waystay-orange)]">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--waystay-orange-dark)]">Check in</span>
          <input
            type="date"
            value={startDate}
            min={today}
            onChange={e => {
              setStartDate(e.target.value)
              if (activeTab === 'FULLDAY' && endDate <= e.target.value) setEndDate(addDays(e.target.value, 1))
              if (activeTab !== 'FULLDAY') setEndDate(e.target.value)
            }}
            className="w-full bg-transparent text-sm font-bold text-[var(--waystay-blue)] outline-none"
          />
        </label>
        <label className={`rounded-xl border-2 px-3 py-1.5 transition ${activeTab === 'FULLDAY' ? 'border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] focus-within:border-[var(--waystay-orange)]' : 'border-[#ece7df] bg-[#f7f4ef]'}`}>
          <span className={`block text-[10px] font-bold uppercase tracking-wide ${activeTab === 'FULLDAY' ? 'text-[var(--waystay-orange-dark)]' : 'text-[#9aa0aa]'}`}>Check out</span>
          <input
            type="date"
            value={endDate}
            min={addDays(startDate, 1)}
            onChange={e => setEndDate(e.target.value)}
            disabled={activeTab !== 'FULLDAY'}
            className="w-full bg-transparent text-sm font-bold text-[var(--waystay-blue)] outline-none disabled:text-[#9aa0aa]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--waystay-orange-dark)]">Guests</span>
          <div className="flex items-center justify-between rounded-xl border-2 border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-2 py-1.5">
            <button type="button" onClick={() => updateGuestCount(guestCount - 1)} className="h-7 w-7 rounded-full border-2 border-[var(--waystay-orange-tint)] bg-white text-sm font-bold text-[var(--waystay-blue)] transition hover:border-[var(--waystay-orange)]" aria-label="Decrease guests">-</button>
            <span className="text-sm font-bold text-[var(--waystay-blue)]">{guestCount}</span>
            <button type="button" onClick={() => updateGuestCount(guestCount + 1)} className="h-7 w-7 rounded-full border-2 border-[var(--waystay-orange-tint)] bg-white text-sm font-bold text-[var(--waystay-blue)] transition hover:border-[var(--waystay-orange)]" aria-label="Increase guests">+</button>
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--waystay-orange-dark)]">Rooms</span>
          <div className="flex items-center justify-between rounded-xl border-2 border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-2 py-1.5">
            <button type="button" onClick={() => updateRoomCount(roomCount - 1)} disabled={roomCount <= requiredRooms} className="h-7 w-7 rounded-full border-2 border-[var(--waystay-orange-tint)] bg-white text-sm font-bold text-[var(--waystay-blue)] transition hover:border-[var(--waystay-orange)] disabled:opacity-40" aria-label="Decrease rooms">-</button>
            <span className="text-sm font-bold text-[var(--waystay-blue)]">{roomCount}</span>
            <button type="button" onClick={() => updateRoomCount(roomCount + 1)} disabled={roomCount >= roomSelectionLimit} className="h-7 w-7 rounded-full border-2 border-[var(--waystay-orange-tint)] bg-white text-sm font-bold text-[var(--waystay-blue)] transition hover:border-[var(--waystay-orange)] disabled:opacity-40" aria-label="Increase rooms">+</button>
          </div>
        </div>
        <div className="self-end rounded-xl border border-[#ece7df] bg-[#f7f4ef] px-3 py-2 text-xs text-[#566378]">
          <span className="block font-bold text-[var(--waystay-blue)]">Max {guestsPerRoomLimit} guests per room</span>
          {requiredRooms > roomSelectionLimit
            ? `This category has only ${roomSelectionLimit} room${roomSelectionLimit === 1 ? '' : 's'}; reduce the guest count.`
            : requiredRooms > 1 ? `${guestCount} guests need at least ${requiredRooms} rooms.` : 'One room is enough for this group.'}
        </div>
      </div>

      <div role="group" aria-label="Stay duration" className="relative mb-4 grid grid-cols-4 rounded-xl border-2 border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] p-1">
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-1 left-1 rounded-lg shadow-sm transition-transform duration-300 ease-out ${activeTab === 'FULLDAY' ? 'bg-[var(--waystay-orange)]' : 'bg-[var(--waystay-blue)]'}`}
          style={{
            width: 'calc((100% - 0.5rem) / 4)',
            transform: `translateX(${SLOT_TABS.indexOf(activeTab) * 100}%)`,
          }}
        />
        {SLOT_TABS.map(t => (
          <button
            key={t}
            type="button"
            disabled={!enabledTabs[t]}
            aria-pressed={activeTab === t}
            onClick={() => {
              setActiveTab(t)
              if (t === 'FULLDAY' && endDate <= startDate) setEndDate(addDays(startDate, 1))
              if (t !== 'FULLDAY') setEndDate(startDate)
            }}
            className={`relative z-10 rounded-lg px-2 py-2 text-[13px] font-bold tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${activeTab === t ? 'text-white' : 'text-[var(--waystay-blue)] hover:bg-white/70'}`}
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
          {filteredSlots.map(slot => {
            const isPast = Boolean(slot.hasStarted) || slotIsPastForBooking(slot.slotType, slot.date, slot.startTime, currentTime)
            const isEnabled = enabledTabs[activeTab] && slot.isEnabled !== false
            const isUnavailable = !isEnabled || slot.isBooked || isPast || requiredRooms > roomSelectionLimit

            return (
              <button
                key={slot.id}
                type="button"
                disabled={isUnavailable}
                onClick={() => handleSlotSelect(slot)}
                className={`min-w-32 rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition ${isUnavailable ? 'cursor-not-allowed border-[#ece7df] bg-[#f7f4ef] text-[#b6bcc6]' : 'border-[var(--waystay-orange-tint)] bg-white text-[var(--waystay-blue)] shadow-sm hover:-translate-y-0.5 hover:border-[var(--waystay-orange)] focus:outline-none focus:ring-2 focus:ring-orange-100'}`}
              >
                {slot.startTime} – {slot.endTime}
                {!isEnabled
                  ? <span className="block text-xs text-gray-400">Not offered</span>
                  : isPast
                  ? <span className="block text-xs text-gray-400">Started</span>
                  : slot.isBooked
                    ? <span className="block text-xs text-gray-400">Booked</span>
                    : <span className="mt-0.5 block text-sm font-bold text-[var(--waystay-orange-dark)]">₹{getPrice(activeTab)}</span>}
              </button>
            )
          })}
          {!loading && filteredSlots.length === 0 && (
            <p className="text-sm text-gray-400">{enabledTabs[activeTab] ? `No ${SLOT_LABELS[activeTab]} slots for this date` : `${SLOT_LABELS[activeTab]} stays are not offered for this room`}</p>
          )}
        </div>
      )}
    </div>
  )
}
