'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SLOT_OPTIONS = [
  { value: 'H3', label: '3 Hours' },
  { value: 'H6', label: '6 Hours' },
  { value: 'H12', label: '12 Hours' },
  { value: 'FULLDAY', label: 'Full Day' },
]

type SlotValue = 'H3' | 'H6' | 'H12' | 'FULLDAY'

function normalizeSlot(slot?: string): SlotValue {
  return slot === 'H6' || slot === 'H12' || slot === 'FULLDAY' ? slot : 'H3'
}

export default function SearchBar({
  className = '',
  initialCity = '',
  initialStartDate,
  initialEndDate,
  initialSlot,
}: {
  className?: string
  initialCity?: string
  initialStartDate?: string
  initialEndDate?: string
  initialSlot?: string
}) {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]
  const [city, setCity] = useState(initialCity)
  const [startDate, setStartDate] = useState(initialStartDate || today)
  const [endDate, setEndDate] = useState(initialEndDate || initialStartDate || today)
  const [slot, setSlot] = useState<SlotValue>(normalizeSlot(initialSlot))

  const handleSearch = (next?: Partial<{ city: string; startDate: string; endDate: string; slot: SlotValue }>) => {
    const nextCity = next?.city ?? city
    const nextStartDate = next?.startDate ?? startDate
    const nextEndDate = next?.endDate ?? endDate
    const nextSlot = next?.slot ?? slot

    if (!nextCity.trim()) return
    const params = new URLSearchParams({
      city: nextCity,
      startDate: nextStartDate,
      endDate: nextSlot === 'FULLDAY' ? nextEndDate : nextStartDate,
      slot: nextSlot,
    })
    router.push('/hotels?' + params.toString())
  }

  return (
    <div className={`bg-white rounded-2xl p-2 flex flex-col md:flex-row gap-2 shadow-lg ${className}`}>
      <input
        type="text"
        placeholder="City or area (e.g. Bangalore)"
        value={city}
        onChange={e => setCity(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSearch()}
        className="flex-1 px-4 py-3 text-gray-800 text-sm focus:outline-none rounded-xl"
      />
      <input
        type="date"
        value={startDate}
        min={today}
        onChange={e => {
          setStartDate(e.target.value)
          if (endDate < e.target.value) setEndDate(e.target.value)
        }}
        className="px-4 py-3 text-gray-800 text-sm focus:outline-none rounded-xl border-l border-gray-100"
      />
      <input
        type="date"
        value={endDate}
        min={startDate}
        onChange={e => setEndDate(e.target.value)}
        disabled={slot !== 'FULLDAY'}
        className="px-4 py-3 text-gray-800 text-sm focus:outline-none rounded-xl border-l border-gray-100 disabled:bg-gray-50 disabled:text-gray-400"
      />
      <select
        value={slot}
        onChange={e => {
          const nextSlot = normalizeSlot(e.target.value)
          const nextEndDate = nextSlot === 'FULLDAY' ? endDate : startDate
          setSlot(nextSlot)
          setEndDate(nextEndDate)
          handleSearch({ slot: nextSlot, endDate: nextEndDate })
        }}
        className="px-4 py-3 text-gray-800 text-sm focus:outline-none rounded-xl bg-white border-l border-gray-100"
      >
        {SLOT_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => handleSearch()}
        className="bg-indigo-600 text-white px-8 py-3 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap"
      >
        Search hotels
      </button>
    </div>
  )
}
