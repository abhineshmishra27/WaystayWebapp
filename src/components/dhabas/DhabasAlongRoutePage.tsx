'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import GooglePlacePhoto from './GooglePlacePhoto'
import { useDhabaRouteResults, type DhabaRouteResult, type RouteDhaba } from './DhabaRouteResultsContext'
import './DhabasAlongRoutePage.css'

function routeLabel(result: DhabaRouteResult | null) {
  if (!result?.route) return 'Your selected route'
  return `${result.route.from.name} to ${result.route.to.name}`
}

function distanceLabel(dhaba: RouteDhaba, nearby: boolean) {
  if (nearby) {
    return dhaba.detourKm < 1 ? `${Math.max(50, Math.round(dhaba.detourKm * 1_000))} m away` : `${dhaba.detourKm.toFixed(1)} km away`
  }
  const minutes = dhaba.minutesAhead > 0 ? `${dhaba.minutesAhead} min ahead` : 'At your starting point'
  const detour = dhaba.detourKm > 0 ? `${dhaba.detourKm.toFixed(1)} km detour` : 'On route'
  return `${minutes} · ${detour}`
}

function DhabaResultCard({ dhaba, nearby }: { dhaba: RouteDhaba; nearby: boolean }) {
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
        <p className="dhaba-result-distance">{distanceLabel(dhaba, nearby)}</p>
        {dhaba.address && <p className="dhaba-result-address">{dhaba.address}</p>}
        <div className="dhaba-result-tags">{dhaba.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        {dhaba.mapsUri && <a className="dhaba-result-maps" href={dhaba.mapsUri} target="_blank" rel="noreferrer">Open in Google Maps <span aria-hidden="true">↗</span></a>}
      </div>
    </article>
  )
}

export default function DhabasAlongRoutePage({ query }: { query: string }) {
  const { getRouteResult, setRouteResult } = useDhabaRouteResults()
  const [result, setResult] = useState<DhabaRouteResult | null>(() => getRouteResult(query))
  const [loading, setLoading] = useState(() => Boolean(query) && !getRouteResult(query))
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!query || result) return

    const controller = new AbortController()
    fetch(`/api/route-stops?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Unable to load dhabas for this route.')
        setResult(payload)
        setRouteResult(query, payload)
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
  }, [query, result, setRouteResult])

  async function loadMore() {
    const nextPageToken = result?.dhabaPagination?.nextPageToken
    if (!result || !nextPageToken || loadingMore) return

    setLoadingMore(true)
    setError('')
    try {
      const params = new URLSearchParams(query)
      params.set('dhabaPageToken', nextPageToken)
      const response = await fetch(`/api/route-stops?${params}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load more food stops.')

      const knownIds = new Set(result.dhabas.map(dhaba => dhaba.id))
      const nextResult: DhabaRouteResult = {
        ...result,
        route: payload.route ?? result.route,
        dhabas: [...result.dhabas, ...(payload.dhabas ?? []).filter((dhaba: RouteDhaba) => !knownIds.has(dhaba.id))],
        dhabaProvider: payload.dhabaProvider ?? result.dhabaProvider,
        dhabaNotice: payload.dhabaNotice ?? null,
        dhabaPagination: payload.dhabaPagination,
      }
      setResult(nextResult)
      setRouteResult(query, nextResult)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load more food stops.')
    } finally {
      setLoadingMore(false)
    }
  }

  const message = query ? error : 'Choose a route first to see dhabas along the way.'
  const nearby = result?.mode === 'nearby'

  return (
    <main className="dhaba-results-page">
      <div className="dhaba-results-shell">
        <Link className="dhaba-results-back" href="/">← Change route</Link>

        <header className="dhaba-results-header">
          <p>{nearby ? 'Food stops near you' : 'Food stops on your journey'}</p>
          <h1>{nearby ? 'Food stops within 5 km' : `All food stops along ${routeLabel(result)}`}</h1>
          {result?.route && <span>{result.route.highway} · {result.route.distanceKm} km · Within 1 km of the driving route</span>}
          {nearby && <span>Within 5 km of your selected location</span>}
        </header>

        {result?.dhabaNotice && <p className="dhaba-results-notice">{result.dhabaNotice}</p>}
        {loading && <div className="dhaba-results-loading" aria-label="Loading dhabas"><span /><span /><span /></div>}
        {!loading && message && <div className="dhaba-results-empty"><p>{message}</p><Link href="/">Find a route</Link></div>}
        {!loading && !message && result?.dhabas.length === 0 && !result.dhabaPagination?.nextPageToken && <div className="dhaba-results-empty"><p>{nearby ? 'No food stops were found within 5 km of this location.' : 'No food stops were found within 1 km of this route.'}</p><Link href="/">Try another route</Link></div>}
        {!loading && !message && (result?.dhabas.length ?? 0) > 0 && (
          <section className="dhaba-results-grid" aria-label={nearby ? 'All food stops near you' : 'All food stops on this route'}>
            {result!.dhabas.map(dhaba => <DhabaResultCard key={dhaba.id} dhaba={dhaba} nearby={nearby} />)}
          </section>
        )}
        {!loading && !message && result?.dhabaPagination?.nextPageToken && (
          <div className="dhaba-results-more">
            <button type="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading more food stops…' : 'Load more food stops'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
