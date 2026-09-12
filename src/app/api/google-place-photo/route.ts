import 'server-only'

import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_PLACE_PHOTO_PREFIX = 'https://places.googleapis.com/v1/'
const PLACE_PHOTO_NAME = /^places\/[^/]+\/photos\/[^/]+$/

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() ?? ''
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')
  const key = apiKey()
  if (!name || !PLACE_PHOTO_NAME.test(name) || !key) {
    return NextResponse.json({ error: 'Place photo is unavailable.' }, { status: 404 })
  }

  const photoUrl = new URL(`${GOOGLE_PLACE_PHOTO_PREFIX}${name}/media`)
  photoUrl.searchParams.set('maxHeightPx', '600')
  photoUrl.searchParams.set('skipHttpRedirect', 'true')

  let response: Response
  try {
    response = await fetch(photoUrl, {
      headers: { 'X-Goog-Api-Key': key },
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: 'Place photo is unavailable.' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Place photo is unavailable.' }, { status: response.status })
  }

  const payload = await response.json() as { photoUri?: string }
  if (!payload.photoUri?.startsWith('https://')) {
    return NextResponse.json({ error: 'Place photo is unavailable.' }, { status: 502 })
  }

  return NextResponse.redirect(payload.photoUri)
}
