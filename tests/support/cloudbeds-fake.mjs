import { createServer } from 'node:http'

/**
 * A stand-in Cloudbeds API, so the whole import and sync pipeline can be exercised
 * before real credentials exist.
 *
 * What this proves: the adapter's HTTP layer, the response envelope handling, token
 * exchange and refresh, and every orchestration step from "connection row" to "bookable
 * hotel with holds". What it deliberately cannot prove is whether the real Cloudbeds
 * uses these field names - the detailed schemas are behind a partner login, so the
 * readers in cloudbeds.ts are educated guesses. This fixture encodes the same guesses,
 * so agreement here means the pipeline is sound, not that the guesses are right.
 *
 * Shapes follow the documented envelope: { success: true, data: ... }.
 */

export const FAKE_PROPERTY_ID = 'fake-prop-1'

export function createCloudbedsFake(options = {}) {
  const state = {
    requests: [],
    accessTokenIssued: 0,
    refreshCount: 0,
    /** Set to make the next API call answer 401, exercising the refresh-and-retry path. */
    rejectNextWithAuthError: false,
    availabilityByDate: options.availabilityByDate ?? {},
    unitCount: options.unitCount ?? 3,
    currency: options.currency ?? 'INR',
    timezone: options.timezone ?? 'Asia/Kolkata',
  }

  function send(response, status, body) {
    const payload = JSON.stringify(body)
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(payload)
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const method = url.pathname.split('/').pop()
    state.requests.push({ method, query: Object.fromEntries(url.searchParams) })

    if (method === 'access_token') {
      let body = ''
      request.on('data', chunk => (body += chunk))
      request.on('end', () => {
        const form = new URLSearchParams(body)
        if (form.get('grant_type') === 'refresh_token') state.refreshCount++
        state.accessTokenIssued++
        send(response, 200, {
          access_token: `fake-access-${state.accessTokenIssued}`,
          refresh_token: `fake-refresh-${state.accessTokenIssued}`,
          expires_in: 28_800,
          scope: 'read:hotel read:room read:rate read:reservation write:reservation read:availability',
        })
      })
      return
    }

    if (state.rejectNextWithAuthError) {
      state.rejectNextWithAuthError = false
      send(response, 401, { success: false, message: 'token expired' })
      return
    }

    const property = {
      propertyID: FAKE_PROPERTY_ID,
      propertyName: 'Fake Harbour Hotel',
      propertyDescription: 'A property that exists only to exercise the import pipeline.',
      propertyAddress1: '5 Fake Quay',
      propertyCity: 'Bengaluru',
      propertyState: 'Karnataka',
      propertyCountry: 'India',
      propertyZip: '560001',
      propertyLatitude: 12.9611,
      propertyLongitude: 77.6387,
      propertyCurrency: { currencyCode: state.currency },
      propertyTimezone: state.timezone,
      propertyCheckIn: '14:00',
      propertyCheckOut: '11:00',
      propertyAmenities: ['WiFi', 'Parking', 'wifi'],
      propertyImage: ['https://fake.test/room.jpg'],
    }

    if (method === 'getHotels') return send(response, 200, { success: true, data: [property] })
    if (method === 'getHotelDetails') return send(response, 200, { success: true, data: property })

    if (method === 'getRoomTypes') {
      return send(response, 200, {
        success: true,
        data: [
          {
            roomTypeID: 'rt-standard',
            roomTypeName: 'Standard Queen',
            roomTypeDescription: 'Queen bed',
            roomsAvailable: state.unitCount,
            maxGuests: 2,
            roomRate: 2500,
            roomTypeFeatures: ['AC'],
            roomTypePhotos: ['https://fake.test/standard.jpg'],
          },
          {
            roomTypeID: 'rt-deluxe',
            roomTypeName: 'Deluxe King',
            roomsAvailable: 2,
            maxGuests: 3,
            roomRate: 4200,
          },
        ],
      })
    }

    if (method === 'getRatePlans') {
      return send(response, 200, {
        success: true,
        data: [
          { roomTypeID: 'rt-standard', ratePlanID: 'rp-standard', rate: 2600 },
          { roomTypeID: 'rt-deluxe', ratePlanID: 'rp-deluxe', rate: 4400 },
        ],
      })
    }

    if (method === 'getAvailableRoomTypes') {
      const startDate = url.searchParams.get('startDate')
      const endDate = url.searchParams.get('endDate')
      const dates = []
      for (let d = startDate; d <= endDate; d = nextDate(d)) dates.push(d)

      return send(response, 200, {
        success: true,
        data: [
          {
            propertyID: FAKE_PROPERTY_ID,
            rooms: [
              {
                roomTypeID: 'rt-standard',
                roomsAvailableByDate: dates.map(date => ({
                  date,
                  roomsAvailable: state.availabilityByDate[date] ?? state.unitCount,
                  isClosed: state.availabilityByDate[date] === 'closed',
                  rate: 2600,
                })),
              },
              {
                roomTypeID: 'rt-deluxe',
                roomsAvailableByDate: dates.map(date => ({ date, roomsAvailable: 2, rate: 4400 })),
              },
            ],
          },
        ],
      })
    }

    send(response, 404, { success: false, message: `fake has no handler for ${method}` })
  })

  return {
    state,
    async listen() {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address()
      return {
        apiBase: `http://127.0.0.1:${port}/api/v1.2`,
        oauthBase: `http://127.0.0.1:${port}/api/v1.3`,
      }
    },
    async close() {
      await new Promise(resolve => server.close(resolve))
    },
    callsTo(method) {
      return state.requests.filter(entry => entry.method === method)
    },
  }
}

function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}
