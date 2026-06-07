'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SLOT_OPTIONS = [
  { value: 'H3', label: '3 Hours' },
  { value: 'H6', label: '6 Hours' },
  { value: 'H12', label: '12 Hours' },
  { value: 'FULLDAY', label: 'Full Day' },
]

export default function SearchBar({ className = '' }: { className?: string }) {
  const router = useRouter()
  const [city, setCity] = useState('')
  const today = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [slot, setSlot] = useState('H3')

  const handleSearch = () => {
    if (!city.trim()) return
    const params = new URLSearchParams({ city, startDate, endDate, slot })
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
          setSlot(e.target.value)
          if (e.target.value !== 'FULLDAY') setEndDate(startDate)
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
        onClick={handleSearch}
        className="bg-indigo-600 text-white px-8 py-3 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap"
      >
        Search hotels
      </button>
    </div>
  )
}
