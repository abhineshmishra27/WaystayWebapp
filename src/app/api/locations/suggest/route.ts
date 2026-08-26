import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeLocationQuery } from '@/lib/location-search'
import { suggestSearchPlaces } from '@/lib/search-db'

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
    const { success } = await rateLimit(`location-suggest:${ip}`, 120, 60 * 1000)
    if (!success) {
      return NextResponse.json({ error: 'Too many suggestion requests.' }, { status: 429 })
    }

    const query = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100)
    if (normalizeLocationQuery(query).length < 2) {
      return NextResponse.json({ query, groups: { locations: [], hotels: [], landmarks: [] } })
    }

    const groups = await suggestSearchPlaces(query)
    return NextResponse.json(
      { query, groups },
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } },
    )
  } catch (error) {
    console.error('Location suggestion error:', error)
    return NextResponse.json({ error: 'Unable to load location suggestions' }, { status: 500 })
  }
}
