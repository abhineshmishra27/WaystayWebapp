'use client'

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'

export type RouteDhaba = {
  id: string
  hotelId: string | null
  name: string
  address: string | null
  image: string | null
  photoName: string | null
  photoAttributions: Array<{ displayName: string; uri: string | null }>
  rating: number
  reviewCount: number
  startingPrice?: number | null
  tags: string[]
  detourKm: number
  minutesAhead: number
  mapsUri: string | null
  websiteUri?: string | null
  source: 'google' | 'waystay'
}

export type DhabaRouteResult = {
  mode?: 'route' | 'nearby'
  route: null | {
    from: { id?: string; name: string; state?: string | null }
    to: { id?: string; name: string; state?: string | null }
    highway: string
    distanceKm: number
    corridorKm?: number
    expanded?: boolean
  }
  dhabas: RouteDhaba[]
  dhabaProvider?: 'google' | 'waystay'
  dhabaNotice?: string | null
  dhabaPagination?: { nextPageToken: string | null }
}

type StoredRouteResult = {
  query: string
  result: DhabaRouteResult
}

type DhabaRouteResultsContextValue = {
  getRouteResult: (query: string) => DhabaRouteResult | null
  setRouteResult: (query: string, result: DhabaRouteResult) => void
}

const DhabaRouteResultsContext = createContext<DhabaRouteResultsContextValue | null>(null)

function normaliseQuery(query: string) {
  return query.replace(/^\?/, '')
}

/**
 * Keeps only the route result that is currently being viewed. This is intentionally
 * in memory: Google Places content is neither persisted nor shared with the server.
 */
export function DhabaRouteResultsProvider({ children }: { children: ReactNode }) {
  const currentResult = useRef<StoredRouteResult | null>(null)

  const getRouteResult = useCallback((query: string) => {
    const current = currentResult.current
    return current?.query === normaliseQuery(query) ? current.result : null
  }, [])

  const setRouteResult = useCallback((query: string, result: DhabaRouteResult) => {
    currentResult.current = { query: normaliseQuery(query), result }
  }, [])

  return (
    <DhabaRouteResultsContext.Provider value={{ getRouteResult, setRouteResult }}>
      {children}
    </DhabaRouteResultsContext.Provider>
  )
}

export function useDhabaRouteResults() {
  const value = useContext(DhabaRouteResultsContext)
  if (!value) throw new Error('useDhabaRouteResults must be used within DhabaRouteResultsProvider.')
  return value
}
