'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { defaultSearchDateForSlot, todayInIndia } from '@/lib/booking-time'

const HOUR_SLOT_OPTIONS = [
  { value: 'H3', label: '3 Hours' },
  { value: 'H6', label: '6 Hours' },
  { value: 'H12', label: '12 Hours' },
] as const

type SlotValue = 'H3' | 'H6' | 'H12' | 'FULLDAY'
type RentalMode = 'hourly' | 'day'
const MAX_GUESTS_PER_ROOM = 3
const RECENT_SEARCHES_KEY = 'waystay:recent-searches'

interface PlaceSuggestion {
  id: string
  kind: 'LOCATION' | 'HOTEL' | 'LANDMARK'
  name: string
  label: string
  city: string | null
  state: string | null
  locationId: string | null
  placeId: string | null
  matchedText: string
}

interface SuggestionGroups {
  locations: PlaceSuggestion[]
  hotels: PlaceSuggestion[]
  landmarks: PlaceSuggestion[]
}

interface RecentSearch {
  id: string
  label: string
  locationId?: string
  placeId?: string
}

const EMPTY_SUGGESTIONS: SuggestionGroups = { locations: [], hotels: [], landmarks: [] }

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchIndex = text.toLocaleLowerCase().indexOf(normalizedQuery)
  if (!normalizedQuery || matchIndex < 0) return <>{text}</>

  return (
    <>
      {text.slice(0, matchIndex)}
      <mark className="rounded-sm bg-amber-100 font-semibold text-inherit">{text.slice(matchIndex, matchIndex + normalizedQuery.length)}</mark>
      {text.slice(matchIndex + normalizedQuery.length)}
    </>
  )
}

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
  initialLocationId,
  initialPlaceId,
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
  initialLocationId?: string
  initialPlaceId?: string
}) {
  const router = useRouter()
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const startDateWasChosen = useRef(Boolean(initialStartDate))
  const normalizedInitialSlot = normalizeSlot(initialSlot)
  const today = todayInIndia()
  const defaultSearchDate = defaultSearchDateForSlot(normalizedInitialSlot)
  const hasInitialLocation = Boolean(initialLat && initialLng)
  const [city, setCity] = useState(initialCity)
  const [startDate, setStartDate] = useState(initialStartDate || defaultSearchDate)
  const [endDate, setEndDate] = useState(initialEndDate || initialStartDate || defaultSearchDate)
  const [slot, setSlot] = useState<SlotValue>(normalizedInitialSlot)
  const [guestCount, setGuestCount] = useState(positiveInt(initialGuestCount, 1))
  const [roomCount, setRoomCount] = useState(Math.max(positiveInt(initialRoomCount, 1), Math.ceil(positiveInt(initialGuestCount, 1) / MAX_GUESTS_PER_ROOM)))
  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId || '')
  const [selectedPlaceId, setSelectedPlaceId] = useState(initialPlaceId || '')
  const [suggestions, setSuggestions] = useState<SuggestionGroups>(EMPTY_SUGGESTIONS)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
      return Array.isArray(stored) ? stored.slice(0, 5) : []
    } catch {
      return []
    }
  })
  const rentalMode: RentalMode = slot === 'FULLDAY' ? 'day' : 'hourly'
  const requiredRooms = Math.max(1, Math.ceil(guestCount / MAX_GUESTS_PER_ROOM))
  const allSuggestions = [...suggestions.locations, ...suggestions.hotels, ...suggestions.landmarks]

  useEffect(() => {
    const query = city.trim()
    if (query.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true)
      try {
        const response = await fetch(`/api/locations/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        const data = await response.json()
        if (response.ok) {
          setSuggestions(data.groups ?? EMPTY_SUGGESTIONS)
          setActiveSuggestionIndex(-1)
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSuggestions(EMPTY_SUGGESTIONS)
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [city])

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!searchBoxRef.current?.contains(event.target as Node)) setSuggestionsOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  const updateGuestCount = (nextGuests: number) => {
    const safeGuests = Math.max(1, Math.min(30, nextGuests))
    setGuestCount(safeGuests)
    setRoomCount(prev => Math.max(prev, Math.ceil(safeGuests / MAX_GUESTS_PER_ROOM)))
  }

  const updateRoomCount = (nextRooms: number) => {
    setRoomCount(Math.max(requiredRooms, Math.min(10, nextRooms)))
  }

  const rememberSearch = (search: RecentSearch) => {
    const nextRecent = [search, ...recentSearches.filter(item => item.id !== search.id)].slice(0, 5)
    setRecentSearches(nextRecent)
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(nextRecent))
    } catch {
      // Recent searches are an enhancement; private browsing may block storage.
    }
  }

  const handleSearch = (
    next?: Partial<{ city: string; startDate: string; endDate: string; slot: SlotValue }>,
    selection?: Pick<PlaceSuggestion, 'label' | 'locationId' | 'placeId'>,
  ) => {
    const nextCity = next?.city ?? city
    const nextStartDate = next?.startDate ?? startDate
    const nextEndDate = next?.endDate ?? endDate
    const nextSlot = next?.slot ?? slot
    const trimmedCity = nextCity.trim()
    const nextLocationId = selection?.locationId ?? selectedLocationId
    const nextPlaceId = selection?.placeId ?? selectedPlaceId

    const params = new URLSearchParams({
      startDate: nextStartDate,
      endDate: nextSlot === 'FULLDAY' ? nextEndDate : nextStartDate,
      slot: nextSlot,
      guestCount: guestCount.toString(),
      roomCount: roomCount.toString(),
    })
    if (trimmedCity) {
      params.set('city', trimmedCity)
      if (nextLocationId) params.set('locationId', nextLocationId)
      if (nextPlaceId) params.set('placeId', nextPlaceId)
      rememberSearch({
        id: nextLocationId ? `location:${nextLocationId}` : nextPlaceId ? `hotel:${nextPlaceId}` : `text:${trimmedCity.toLocaleLowerCase()}`,
        label: selection?.label ?? trimmedCity,
        locationId: nextLocationId || undefined,
        placeId: nextPlaceId || undefined,
      })
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

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    setCity(suggestion.label)
    setSelectedLocationId(suggestion.locationId || '')
    setSelectedPlaceId(suggestion.placeId || '')
    setSuggestionsOpen(false)
    handleSearch(
      { city: suggestion.label },
      { label: suggestion.label, locationId: suggestion.locationId, placeId: suggestion.placeId },
    )
  }

  const selectRecentSearch = (recent: RecentSearch) => {
    setCity(recent.label)
    setSelectedLocationId(recent.locationId || '')
    setSelectedPlaceId(recent.placeId || '')
    setSuggestionsOpen(false)
    handleSearch(
      { city: recent.label },
      { label: recent.label, locationId: recent.locationId || null, placeId: recent.placeId || null },
    )
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(position => {
      const params = new URLSearchParams({
        lat: position.coords.latitude.toString(),
        lng: position.coords.longitude.toString(),
        radius: initialRadius || '50',
        nearMe: '1',
        startDate,
        endDate: slot === 'FULLDAY' ? endDate : startDate,
        slot,
        guestCount: guestCount.toString(),
        roomCount: roomCount.toString(),
      })
      setSuggestionsOpen(false)
      router.push('/hotels?' + params.toString())
    })
  }

  const updateRentalMode = (mode: RentalMode) => {
    if (mode === 'day') {
      const nextStartDate = startDateWasChosen.current ? startDate : today
      const nextEndDate = endDate <= nextStartDate ? addDays(nextStartDate, 1) : endDate
      setSlot('FULLDAY')
      setStartDate(nextStartDate)
      setEndDate(nextEndDate)
      return
    }

    const nextSlot = slot === 'FULLDAY' ? 'H3' : slot
    const nextStartDate = startDateWasChosen.current ? startDate : defaultSearchDateForSlot(nextSlot)
    setSlot(nextSlot)
    setStartDate(nextStartDate)
    setEndDate(nextStartDate)
  }

  const updateHourSlot = (nextSlot: SlotValue) => {
    if (nextSlot === 'FULLDAY') return
    const nextStartDate = startDateWasChosen.current ? startDate : defaultSearchDateForSlot(nextSlot)
    setSlot(nextSlot)
    setStartDate(nextStartDate)
    setEndDate(nextStartDate)
  }

  const suggestionSections = [
    { key: 'locations', label: 'Locations', items: suggestions.locations },
    { key: 'hotels', label: 'Hotels', items: suggestions.hotels },
    { key: 'landmarks', label: 'Landmarks', items: suggestions.landmarks },
  ]

  return (
    <div className={`rounded-2xl border border-white/20 bg-white p-3 shadow-xl ${className}`}>
      <div ref={searchBoxRef} className="relative">
        <label className="flex min-w-0 items-center gap-3 rounded-xl border-2 border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-4 py-2.5 shadow-sm transition focus-within:border-[var(--waystay-orange)] focus-within:bg-white focus-within:ring-4 focus-within:ring-orange-100">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[var(--waystay-orange)]">
            <path d="M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-extrabold uppercase tracking-wider text-[var(--waystay-orange-dark)]">Where</span>
            <input
              type="text"
              role="combobox"
              aria-label="City, area, hotel, landmark or postcode"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen}
              aria-controls="location-suggestions"
              autoComplete="off"
              placeholder={hasInitialLocation ? 'Search another city, area, hotel or landmark' : 'City, area, hotel, landmark or postcode'}
              value={city}
              onFocus={() => setSuggestionsOpen(true)}
              onChange={event => {
                const nextCity = event.target.value
                setCity(nextCity)
                setSelectedLocationId('')
                setSelectedPlaceId('')
                setSuggestionsOpen(true)
                setActiveSuggestionIndex(-1)
                if (nextCity.trim().length < 2) setSuggestions(EMPTY_SUGGESTIONS)
              }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSuggestionsOpen(true)
                  setActiveSuggestionIndex(current => Math.min(current + 1, allSuggestions.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveSuggestionIndex(current => Math.max(current - 1, 0))
                } else if (event.key === 'Escape') {
                  setSuggestionsOpen(false)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const activeSuggestion = allSuggestions[activeSuggestionIndex]
                  if (suggestionsOpen && activeSuggestion) selectSuggestion(activeSuggestion)
                  else handleSearch()
                }
              }}
              className="mt-0.5 w-full bg-transparent text-base font-semibold text-[var(--waystay-blue)] placeholder:text-slate-500 focus:outline-none"
            />
          </span>
        </label>

        {suggestionsOpen && (
          <div id="location-suggestions" role="listbox" className="absolute inset-x-0 top-full z-50 mt-2 max-h-[28rem] overflow-y-auto rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl">
            <button
              type="button"
              onClick={useCurrentLocation}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-indigo-50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600" aria-hidden="true">◎</span>
              <span><span className="block text-sm font-semibold text-indigo-700">Use current location</span><span className="block text-xs text-gray-500">Find available hotels near you</span></span>
            </button>

            {city.trim().length < 2 && recentSearches.length > 0 && (
              <div className="mt-1 border-t border-gray-100 pt-2">
                <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Recent searches</p>
                {recentSearches.map(recent => (
                  <button
                    key={recent.id}
                    type="button"
                    onClick={() => selectRecentSearch(recent)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <span className="text-gray-400" aria-hidden="true">↻</span>
                    <span className="truncate text-sm font-medium text-gray-700">{recent.label}</span>
                  </button>
                ))}
              </div>
            )}

            {city.trim().length >= 2 && suggestionsLoading && (
              <p className="px-3 py-4 text-sm text-gray-400">Finding the best matches…</p>
            )}

            {city.trim().length >= 2 && !suggestionsLoading && suggestionSections.map(section => section.items.length > 0 && (
              <div key={section.key} className="mt-1 border-t border-gray-100 pt-2 first:border-t-0">
                <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{section.label}</p>
                {section.items.map(suggestion => {
                  const suggestionIndex = allSuggestions.findIndex(item => item.kind === suggestion.kind && item.id === suggestion.id)
                  const aliasMatched = suggestion.matchedText.toLocaleLowerCase() !== suggestion.name.toLocaleLowerCase()
                  return (
                    <button
                      key={`${suggestion.kind}:${suggestion.id}`}
                      type="button"
                      role="option"
                      aria-selected={suggestionIndex === activeSuggestionIndex}
                      onMouseEnter={() => setActiveSuggestionIndex(suggestionIndex)}
                      onClick={() => selectSuggestion(suggestion)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left ${suggestionIndex === activeSuggestionIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    >
                      <span className="block text-sm font-semibold text-gray-800"><HighlightedText text={suggestion.name} query={city} /></span>
                      <span className="block text-xs text-gray-500">
                        {[suggestion.city, suggestion.state].filter(Boolean).join(' · ')}
                        {aliasMatched && <span className="ml-1 text-indigo-500">· matched <HighlightedText text={suggestion.matchedText} query={city} /></span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}

            {city.trim().length >= 2 && !suggestionsLoading && allSuggestions.length === 0 && (
              <p className="px-3 py-4 text-sm text-gray-400">No confident matches yet. You can still search this text.</p>
            )}
          </div>
        )}
      </div>
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
                startDateWasChosen.current = true
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
