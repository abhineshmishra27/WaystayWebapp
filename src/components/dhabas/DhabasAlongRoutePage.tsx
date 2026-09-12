'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import GooglePlacePhoto from './GooglePlacePhoto'
import './DhabasAlongRoutePage.css'

type RouteDhaba = {
  id: string
  hotelId: string | null
  name: string
  address: string | null
  image: string | null
  photoName: string | null
  photoAttributions: Array<{ displayName: string; uri: string | null }>
  rating: number
  reviewCount: number
  tags: string[]
  detourKm: number
  minutesAhead: number
  mapsUri: string | null
  source: 'google' | 'waystay'
}

type DhabaRouteResult = {
  route: null | {
    from: { name: string }
    to: { name: string }
    highway: string
    distanceKm: number
  }
  dhabas: RouteDhaba[]
  dhabaProvider?: 'google' | 'waystay'
  dhabaNotice?: string | null
}

function routeLabel(result: DhabaRouteResult | null) {
  if (!result?.route) return 'Your selected route'
  return `${result.route.from.name} to ${result.route.to.name}`
}

function distanceLabel(dhaba: RouteDhaba) {
  const minutes = dhaba.minutesAhead > 0 ? `${dhaba.minutesAhead} min ahead` : 'At your starting point'
  const detour = dhaba.detourKm > 0 ? `${dhaba.detourKm.toFixed(1)} km detour` : 'On route'
  return `${minutes} · ${detour}`
}

function DhabaResultCard({ dhaba }: { dhaba: RouteDhaba }) {
  const isGooglePlace = dhaba.source === 'google'
  return (
    <article className="dhaba-result-card">
      {isGooglePlace ? (
        <GooglePlacePhoto
          photoName={dhaba.photoName}
          attributions={dhaba.photoAttributions}
          alt={`Photo of ${dhaba.name}`}
          wrapperClassName="dhaba-result-photo-wrap"
          imageClassName="dhaba-result-photo"
          attributionClassName="dhaba-photo-attribution"
          fallback={<div className="dhaba-result-photo dhaba-result-photo-fallback" aria-label="Photo unavailable"><span>Photo unavailable</span></div>}
        />
      ) : dhaba.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="dhaba-result-photo" src={dhaba.image} alt={dhaba.name} loading="lazy" />
      ) : (
        <div className="dhaba-result-photo dhaba-result-photo-fallback" aria-label="Photo unavailable"><span>Photo unavailable</span></div>
      )}

      <div className="dhaba-result-content">
        <div className="dhaba-result-name-row">
          <h2>{dhaba.name}</h2>
          <span className="dhaba-result-rating" aria-label={`${dhaba.rating} out of 5 from ${dhaba.reviewCount} reviews`}>★ {dhaba.rating.toFixed(1)} <small>({dhaba.reviewCount})</small></span>
        </div>
        <p className="dhaba-result-distance">{distanceLabel(dhaba)}</p>
        {dhaba.address && <p className="dhaba-result-address">{dhaba.address}</p>}
        <div className="dhaba-result-tags">{dhaba.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        {dhaba.mapsUri && <a className="dhaba-result-maps" href={dhaba.mapsUri} target="_blank" rel="noreferrer">Open in Google Maps <span aria-hidden="true">↗</span></a>}
      </div>
    </article>
  )
}

export default function DhabasAlongRoutePage({ query }: { query: string }) {
  const [result, setResult] = useState<DhabaRouteResult | null>(null)
  const [loading, setLoading] = useState(() => Boolean(query))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!query) return

    const controller = new AbortController()
    fetch(`/api/route-stops?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Unable to load dhabas for this route.')
        setResult(payload)
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setError(error instanceof Error ? error.message : 'Unable to load dhabas for this route.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [query])

  const message = query ? error : 'Choose a route first to see dhabas along the way.'

  return (
    <main className="dhaba-results-page">
      <div className="dhaba-results-shell">
        <Link className="dhaba-results-back" href="/">← Change route</Link>

        <header className="dhaba-results-header">
          <p>Food stops on your journey</p>
          <h1>All dhabas along {routeLabel(result)}</h1>
          {result?.route && <span>{result.route.highway} · {result.route.distanceKm} km · Within 1 km of the driving route</span>}
        </header>

        {result?.dhabaNotice && <p className="dhaba-results-notice">{result.dhabaNotice}</p>}
        {loading && <div className="dhaba-results-loading" aria-label="Loading dhabas"><span /><span /><span /></div>}
        {!loading && message && <div className="dhaba-results-empty"><p>{message}</p><Link href="/">Find a route</Link></div>}
        {!loading && !message && result?.dhabas.length === 0 && <div className="dhaba-results-empty"><p>No dhabas were found within 1 km of this route.</p><Link href="/">Try another route</Link></div>}
        {!loading && !message && (result?.dhabas.length ?? 0) > 0 && (
          <section className="dhaba-results-grid" aria-label="All dhabas on this route">
            {result!.dhabas.map(dhaba => <DhabaResultCard key={dhaba.id} dhaba={dhaba} />)}
          </section>
        )}
      </div>
    </main>
  )
}
