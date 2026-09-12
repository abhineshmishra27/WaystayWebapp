'use client'

import "./RouteExplorerHomepage.css"
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { defaultSearchDateForSlot } from '@/lib/booking-time'
import GooglePlacePhoto from '@/components/dhabas/GooglePlacePhoto'
import { useDhabaRouteResults, type RouteDhaba } from '@/components/dhabas/DhabaRouteResultsContext'

type DiscoveryMode = 'all' | 'stays' | 'dhabas'
type SearchScope = 'route' | 'nearby'

type EndpointValue = {
  text: string
  locationId: string
}

type LocationSuggestion = {
  id: string
  name: string
  label: string
  city: string | null
  state: string | null
  locationId: string | null
  kind: 'LOCATION' | 'LANDMARK'
}

type RouteStay = {
  id: string
  name: string
  image: string | null
  avgRating: number
  reviewCount: number
  selectedSlotPrice: number | null
  availableStayType: 'H3' | 'FULLDAY'
  detourKm: number
  minutesAhead: number
}

type RouteResult = {
  mode: SearchScope
  route: null | {
    from: { id: string; name: string; state: string | null }
    to: { id: string; name: string; state: string | null }
    highway: string
    distanceKm: number
    corridorKm: number
    expanded: boolean
  }
  stays: RouteStay[]
  dhabas: RouteDhaba[]
  dhabaProvider?: 'google' | 'waystay'
  dhabaNotice?: string | null
  dhabaPagination?: { nextPageToken: string | null }
}

const categoryOptions: Array<{ id: DiscoveryMode; label: string; hint: string; icon: string }> = [
  { id: 'all', label: 'Explore all', hint: '', icon: 'compass' },
  { id: 'stays', label: 'Trusted Stays', hint: 'Hourly & overnight', icon: 'bed' },
  { id: 'dhabas', label: 'Dhabas', hint: 'Rated by travellers', icon: 'food' },
]

const offers = [
  {
    badge: 'First stop',
    title: '10% off your first booking',
    description: 'Use your first Waystay rest stop for a short day slot or an overnight break.',
    cta: 'Code: WAY10',
    href: '/hotels?slot=H3',
    image: '/introductory-offer-beach.png',
    imageAlt: '10% introductory offer',
    containImage: false,
  },
  {
    badge: 'Day slot',
    title: '3-hour rooms from ₹349',
    description: 'Freshen up, feed the kids, nap safely, and get back on the road.',
    cta: 'Book a 3-hour slot',
    href: '/hotels?slot=H3',
    image: '/day-slot-hourly-slots.png',
    imageAlt: 'Hourly slots from 3 hours',
    containImage: true,
  },
  {
    badge: 'Family ready',
    title: 'Verified family kit included',
    description: 'Assured sheets, RO water, washroom check, and secure parking at listed stops.',
    cta: 'See full-day stays',
    href: '/hotels?slot=FULLDAY',
    image: '/family-kit-icons-banner.png',
    imageAlt: 'Verified family kit included',
    containImage: true,
  },
]

const trustPoints = [
  {
    icon: 'shield',
    title: '24/7 monitored properties',
    description: 'Every stop is checked in on around the clock, not just at booking time.',
  },
  {
    icon: 'lock',
    title: 'Secure parking',
    description: 'Lit, attended parking so your vehicle rests as easy as you do.',
  },
  {
    icon: 'check',
    title: 'Verified ground staff',
    description: 'On-site teams are background-checked and managed directly by Waystay.',
  },
]

const dhabaFallbackImages = [
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=85',
  'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85',
]

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    bed: <><path d="M3 18V6m18 12v-7H3m0 4h18M6 11V7h5v4m2 0V7h5a3 3 0 0 1 3 3" /></>,
    food: <><path d="M5 3v6m3-6v6m3-6v6M5 7h6M8 9v12m10-18c-3 3-3 8 0 8h2V3m0 8v10" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6Z" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" /></>,
    shield: <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />,
    lock: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />,
    mail: <><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="m22 6-10 7L2 6" /></>,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] ?? paths.pin}
    </svg>
  )
}

function formatPrice(value: number | null) {
  if (!value || value <= 0) return 'Price on request'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

function addOneDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

function distanceLabel(minutesAhead: number, detourKm: number) {
  const timing = minutesAhead <= 5 ? 'At your starting point' : `${minutesAhead} min ahead`
  const detour = detourKm < 1 ? 'Direct access' : `${Math.max(1, Math.round(detourKm))} km detour`
  return `${timing} · ${detour}`
}

function RouteLocationField({ label, value, onChange }: {
  label: string
  value: EndpointValue
  onChange: (value: EndpointValue) => void
}) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const suggestionsId = `ws-${label.toLowerCase()}-suggestions`

  useEffect(() => {
    const query = value.text.trim()
    if (query.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch(`/api/locations/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(response => response.json())
        .then(payload => {
          const locations = Array.isArray(payload.groups?.locations) ? payload.groups.locations : []
          const landmarks = Array.isArray(payload.groups?.landmarks) ? payload.groups.landmarks : []
          setSuggestions([...locations, ...landmarks].slice(0, 7))
        })
        .catch(error => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestions([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [value.text])

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  return (
    <div ref={wrapperRef} className="ws-location-wrap">
      <label>
        <span>{label.toUpperCase()}</span>
        <input
          aria-label={`${label} location`}
          role="combobox"
          aria-expanded={open}
          aria-controls={suggestionsId}
          autoComplete="off"
          value={value.text}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'Escape') setOpen(false)
          }}
          onChange={event => {
            onChange({ text: event.target.value, locationId: '' })
            setOpen(true)
            if (event.target.value.trim().length < 2) setSuggestions([])
          }}
          placeholder="City, area or highway"
          required
        />
      </label>
      <Icon name="pin" />
      {open && value.text.trim().length >= 2 && (
        <div id={suggestionsId} role="listbox" className="ws-suggestions">
          {loading && <p>Finding places…</p>}
          {!loading && suggestions.map(suggestion => (
            <button
              key={`${suggestion.kind}:${suggestion.id}`}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => {
                onChange({ text: suggestion.label, locationId: suggestion.locationId || suggestion.id })
                setOpen(false)
              }}
            >
              <strong>{suggestion.name}</strong>
              <small>{[suggestion.city, suggestion.state].filter(Boolean).join(', ')}</small>
            </button>
          ))}
          {!loading && suggestions.length === 0 && <p>No matching route location found.</p>}
        </div>
      )}
    </div>
  )
}

function StayCard({ stay, date }: { stay: RouteStay; date: string }) {
  const isNight = stay.availableStayType === 'FULLDAY'
  return (
    <article className="ws-card">
      {/* Hotel images may be supplied by connected channel partners. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ws-card-photo" src={stay.image || '/day-slot-hourly-slots.png'} alt={stay.name} loading="lazy" />
      <div className="ws-card-content">
        <div className="ws-card-title">
          <h4>{stay.name}</h4>
          <span aria-label={`${stay.avgRating} out of 5, ${stay.reviewCount} reviews`}><i>★</i> {Number(stay.avgRating || 0).toFixed(1)} <small>({stay.reviewCount})</small></span>
        </div>
        <p className="ws-distance"><Icon name="pin" />{distanceLabel(stay.minutesAhead, stay.detourKm)}</p>
        <div className="ws-tags"><span className="ws-tag-stay">{isNight ? 'Overnight' : '3-hour stay'}</span></div>
        <div className="ws-card-bottom">
          <p className="ws-price">{formatPrice(stay.selectedSlotPrice)} <small>/ {isNight ? 'night' : '3 hours'}</small></p>
          <Link href={`/hotels/${encodeURIComponent(stay.id)}?date=${date}&startDate=${date}&endDate=${isNight ? addOneDay(date) : date}&slot=${stay.availableStayType}`}>View stay</Link>
        </div>
      </div>
    </article>
  )
}

function DhabaCard({ dhaba, index, date }: { dhaba: RouteDhaba; index: number; date: string }) {
  const isGooglePlace = dhaba.source === 'google'
  return (
    <article className="ws-card">
      {/* Restaurant images may come from owner-managed menu content. */}
      {isGooglePlace ? (
        <GooglePlacePhoto
          photoName={dhaba.photoName}
          attributions={dhaba.photoAttributions}
          alt={`Photo of ${dhaba.name}`}
          wrapperClassName="ws-google-photo-wrap"
          imageClassName="ws-card-photo"
          attributionClassName="ws-photo-attribution"
          fallback={<div className="ws-card-photo ws-google-photo" aria-label="Google Maps dhaba listing"><Icon name="food" /><span>Photo unavailable</span></div>}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ws-card-photo" src={dhaba.image || dhabaFallbackImages[index % dhabaFallbackImages.length]} alt={dhaba.name} loading="lazy" />
      )}
      <div className="ws-card-content">
        <div className="ws-card-title">
          <h4>{dhaba.name}</h4>
          <span aria-label={`${dhaba.rating} out of 5, ${dhaba.reviewCount} reviews`}><i>★</i> {Number(dhaba.rating || 0).toFixed(1)} <small>({dhaba.reviewCount})</small></span>
        </div>
        <p className="ws-distance"><Icon name="pin" />{distanceLabel(dhaba.minutesAhead, dhaba.detourKm)}</p>
        {isGooglePlace && dhaba.address && <p className="ws-dhaba-address">{dhaba.address}</p>}
        <div className="ws-tags">{dhaba.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        <div className="ws-card-bottom is-link-only">
          {isGooglePlace && dhaba.mapsUri ? (
            <a href={dhaba.mapsUri} target="_blank" rel="noreferrer">Open in Maps</a>
          ) : dhaba.hotelId ? (
            <Link href={`/hotels/${encodeURIComponent(dhaba.hotelId)}?date=${date}&startDate=${date}&endDate=${date}&slot=H3#restaurant-menu`}>View dhaba</Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function CardRail({ label, children }: { label: string; children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null)

  function scroll(direction: -1 | 1) {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * Math.max(300, rail.clientWidth * 0.82), behavior: 'smooth' })
  }

  return (
    <div className="ws-card-rail">
      <button className="ws-rail-control ws-rail-control-left" type="button" aria-label={`Show earlier ${label}`} onClick={() => scroll(-1)}><span aria-hidden="true">‹</span></button>
      <div ref={railRef} className="ws-cards" aria-label={label}>
        {children}
      </div>
      <button className="ws-rail-control ws-rail-control-right" type="button" aria-label={`Show more ${label}`} onClick={() => scroll(1)}><span aria-hidden="true">›</span></button>
    </div>
  )
}

function routeQuery(from: EndpointValue, to: EndpointValue, date: string, mode: SearchScope) {
  const params = new URLSearchParams({ date, mode })
  if (mode === 'route') {
    params.set('from', from.text)
    params.set('to', to.text)
    if (from.locationId) params.set('fromLocationId', from.locationId)
    if (to.locationId) params.set('toLocationId', to.locationId)
  } else {
    params.set('near', from.text)
    if (from.locationId) params.set('nearLocationId', from.locationId)
  }
  return params
}

export default function RouteExplorerHomepage() {
  const [category, setCategory] = useState<DiscoveryMode>('all')
  const [mode, setMode] = useState<SearchScope>('route')
  const [from, setFrom] = useState<EndpointValue>({ text: 'Delhi', locationId: '' })
  const [to, setTo] = useState<EndpointValue>({ text: 'Jaipur', locationId: '' })
  const [date, setDate] = useState(() => defaultSearchDateForSlot('H3'))
  const [result, setResult] = useState<RouteResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const { setRouteResult: cacheDhabaRouteResult } = useDhabaRouteResults()

  useEffect(() => {
    const controller = new AbortController()
    const params = routeQuery(
      { text: 'Delhi', locationId: '' },
      { text: 'Jaipur', locationId: '' },
      defaultSearchDateForSlot('H3'),
      'route',
    )
    fetch(`/api/route-stops?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Unable to load route stops.')
        setResult(payload)
        cacheDhabaRouteResult(params.toString(), payload)
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setNotice(error instanceof Error ? error.message : 'Unable to load route stops.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [cacheDhabaRouteResult])

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!from.text.trim() || (mode === 'route' && !to.text.trim())) {
      setNotice(mode === 'route' ? 'Enter both a starting point and destination.' : 'Enter an area to search nearby.')
      return
    }
    setLoading(true)
    setNotice('')
    try {
      const params = routeQuery(from, to, date, mode)
      const response = await fetch(`/api/route-stops?${params}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load route stops.')
      setResult(payload)
      cacheDhabaRouteResult(params.toString(), payload)
      document.getElementById('ws-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load route stops.')
    } finally {
      setLoading(false)
    }
  }

  const showStays = category !== 'dhabas'
  const showDhabas = category !== 'stays'
  const visibleStays = (result?.stays ?? []).slice(0, 10)
  const allStaysHref = `/hotels?slot=H3&startDate=${date}&endDate=${date}`
  const visibleDhabas = (result?.dhabas ?? []).slice(0, 10)
  const allDhabasHref = `/dhabas?${routeQuery(from, to, date, mode).toString()}`
  const displayedRoute = result?.route
  const messages = [
    notice,
    displayedRoute?.expanded
      ? `No available stops were found in the initial corridor. Showing results within ${displayedRoute.corridorKm} km of the route.`
      : '',
    result?.dhabaNotice ?? '',
  ].filter(Boolean)
  return (
    <>
    <main className="ws-demo">

      <section className="ws-hero ws-width" aria-labelledby="ws-title">
        <h1 id="ws-title">Stop the drive,<br />Not the trip</h1>
        <p>Find a comfortable stay or a great dhaba, right along your route.</p>
      </section>

      <section className="ws-search ws-width" aria-label="Find your next stop">
        <div className="ws-categories" role="group" aria-label="Choose a category">
          {categoryOptions.map(item => (
            <button key={item.id} type="button" aria-pressed={category === item.id} className={`ws-category ${category === item.id ? 'is-active' : ''}`} onClick={() => setCategory(item.id)}>
              <span className={`ws-icon ws-${item.id}`}><Icon name={item.icon} /></span>
              <span><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
            </button>
          ))}
        </div>

        <form onSubmit={search}>
          <div className={`ws-fields ${mode === 'nearby' ? 'ws-nearby-fields' : ''}`}>
            <RouteLocationField label={mode === 'route' ? 'From' : 'Near'} value={from} onChange={setFrom} />
            {mode === 'route' && <RouteLocationField label="To" value={to} onChange={setTo} />}
            <label className="ws-date-field"><span>DATE</span><input aria-label="Travel date" type="date" min={defaultSearchDateForSlot('H3')} value={date} onChange={event => setDate(event.target.value)} /></label>
            <button className="ws-primary" type="submit" disabled={loading}>{loading ? 'Finding stops…' : mode === 'route' ? 'Explore my route' : 'Find nearby stops'}<Icon name="arrow" /></button>
          </div>
          <div className="ws-modes">
            <div role="group" aria-label="Search mode">
              <button type="button" aria-pressed={mode === 'route'} onClick={() => setMode('route')}><Icon name="pin" />Along my route</button>
              <button type="button" aria-pressed={mode === 'nearby'} onClick={() => setMode('nearby')}><Icon name="target" />Near me</button>
            </div>
            <span>Live availability · Route distances are estimates</span>
          </div>
        </form>
      </section>

      {messages.length > 0 && (
        <div className="ws-notice ws-width" role="status">
          <span>{messages.join(' ')}</span>
          {notice && <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button>}
        </div>
      )}

      <section id="ws-results" className="ws-results ws-width" aria-label="Stays and dhabas" aria-busy={loading}>
        {loading && <div className="ws-loading"><span /><span /><span /><span /></div>}

        {!loading && (
          <div className={`ws-groups ${category !== 'all' ? 'ws-single' : ''}`}>
            {showStays && (
              <section className="ws-group">
                <div className="ws-group-title">
                  <h3><span className="ws-icon ws-stays"><Icon name="bed" /></span><span>Stay for a while<small>Book by the hour or overnight</small></span></h3>
                  <Link href={allStaysHref}>View all stays<Icon name="arrow" /></Link>
                </div>
                <CardRail label="stays along this route">{visibleStays.map(stay => <StayCard key={stay.id} stay={stay} date={date} />)}</CardRail>
                {visibleStays.length === 0 && <p className="ws-empty">No stays to show right now. Try another location or date.</p>}
              </section>
            )}

            {showDhabas && (
              <section className="ws-group">
                <div className="ws-group-title">
                  <h3><span className="ws-icon ws-dhabas"><Icon name="food" /></span><span>Find a good meal<small>{result?.dhabaProvider === 'google' ? 'Google-listed dhabas within 1 km of your driving route' : 'Compare dhabas before you stop'}</small></span></h3>
                  {(result?.dhabas.length ?? 0) > 2 && <Link href={allDhabasHref}>View all dhabas<Icon name="arrow" /></Link>}
                </div>
                <CardRail label="dhabas along this route">{visibleDhabas.map((dhaba, index) => <DhabaCard key={dhaba.id} dhaba={dhaba} index={index} date={date} />)}</CardRail>
                {visibleDhabas.length === 0 && <p className="ws-empty">No dhabas to show right now. Try another location.</p>}
              </section>
            )}
          </div>
        )}
      </section>

      <section id="offers" className="ws-offers ws-width" aria-labelledby="ws-offers-title">
        <div className="ws-section-head">
          <div>
            <p className="ws-eyebrow">Current offers</p>
            <h2 id="ws-offers-title">Rest stops that cost less than pushing through</h2>
          </div>
          <Link className="ws-section-cta" href="/hotels?slot=H3">View bookable stays<Icon name="arrow" /></Link>
        </div>
        <div className="ws-offer-cards">
          {offers.map(offer => (
            <Link key={offer.title} className="ws-offer" href={offer.href}>
              {/* Marketing artwork ships with the app, matching the img usage in the cards above. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`ws-offer-photo ${offer.containImage ? 'is-contain' : ''}`}
                src={offer.image}
                alt={offer.imageAlt}
                loading="lazy"
              />
              <span className="ws-offer-badge">{offer.badge}</span>
              <h3>{offer.title}</h3>
              <p>{offer.description}</p>
              <span className="ws-offer-cta">{offer.cta}<Icon name="arrow" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section id="trust" className="ws-trust ws-width" aria-labelledby="ws-trust-title">
        <h2 id="ws-trust-title">Built for families on the road</h2>
        <p className="ws-trust-intro">Every property on Waystay is inspected and monitored the same way, whether you&apos;re stopping for three hours or the whole night.</p>
        <div className="ws-trust-points">
          {trustPoints.map(point => (
            <div key={point.title} className="ws-trust-point">
              <span className="ws-trust-icon"><Icon name={point.icon} /></span>
              <h3>{point.title}</h3>
              <p>{point.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="ws-journey-footer ws-width">
        <span className="ws-footer-rule" />
        <svg className="ws-road-illustration" aria-hidden="true" viewBox="0 0 90 60" fill="none">
          <path d="M16 55C48 36 54 26 48 16c-5-7 0-11 10-13M35 56C63 35 69 25 61 16c-5-6-4-9 2-11M63 55c-1-17 15-23 6-36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="m44 47 5-5m5-6 4-5m1-7-1-4M29 45V11m0 0-7 12 7 7 7-7-7-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m29 12-7 11 7 7Z" fill="currentColor" />
        </svg>
        <span>Less detour. More time for your journey.</span>
        <span className="ws-footer-rule" />
      </footer>
    </main>

    <footer className="ws-site-footer">
      <div className="ws-site-footer-inner">
        <div>
          <p className="ws-site-wordmark"><span>Way</span>stay</p>
          <p className="ws-site-tagline">Verified rooms by the hour or the night, on every major highway corridor.</p>
        </div>

        <div>
          <h2>Contact</h2>
          <ul>
            <li><Icon name="phone" /><a href="tel:+918679399678">+91 86793 99678</a></li>
            <li><Icon name="mail" /><a href="mailto:waystayrooms@gmail.com">waystayrooms@gmail.com</a></li>
          </ul>
        </div>

        <div>
          <h2>Waystay</h2>
          <ul>
            <li><Link href="#trust">Why travellers trust us</Link></li>
            <li><Link href="/partner">Partner your property</Link></li>
            <li><a href="mailto:waystayrooms@gmail.com">Help centre</a></li>
            <li><Link href="/hotels">Terms &amp; refund policy</Link></li>
          </ul>
        </div>
      </div>

      <div className="ws-site-footer-base">
        <span>© 2026 Waystay · Every highway, covered</span>
        <span>Payments secured via Razorpay / UPI</span>
      </div>
    </footer>
    </>
  )
}
