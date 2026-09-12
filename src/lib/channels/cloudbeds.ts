import 'server-only'

import {
  ChannelApiError,
  ChannelAuthError,
  type ChannelAdapter,
  type ChannelCredentials,
  type ChannelTokenSet,
  type ChannelWebhookEvent,
  type ExternalAvailability,
  type ExternalProperty,
  type ExternalReservation,
  type ExternalReservationRequest,
  type ExternalRoomType,
} from '@/lib/channels/types'

/**
 * Cloudbeds Public API adapter.
 *
 * Verified against the developer docs (Sept 2026):
 *   - OAuth 2.0 authorization_code + refresh_token; access tokens live 8 hours,
 *     refresh tokens 365 days and extend on each use.
 *   - postReservation accepts `thirdPartyIdentifier`, which we set to the WayStay
 *     booking id so retries cannot create duplicate reservations.
 *   - Webhooks retry 5x at one-minute intervals, arrive out of order, and carry NO
 *     signature. Nothing here trusts a webhook payload as state - see parseWebhookEvent.
 *
 * VERIFY AT IMPLEMENTATION TIME: exact response field names and pagination for each
 * method, and whether the account is on v1.2 or v1.3 per endpoint. The docs list method
 * names but the detailed schemas sit behind a partner login. Every reader below is
 * written defensively and `normalise*` is where a shape correction belongs - do not
 * scatter field-name guesses through the sync layer.
 */

const API_BASE = process.env.CLOUDBEDS_API_BASE ?? 'https://hotels.cloudbeds.com/api/v1.2'
const OAUTH_BASE = process.env.CLOUDBEDS_OAUTH_BASE ?? 'https://api.cloudbeds.com/api/v1.3'
const REQUEST_TIMEOUT_MS = 20_000

export const CLOUDBEDS_SCOPES = [
  'read:hotel',
  'read:room',
  'read:rate',
  'read:reservation',
  'write:reservation',
  'read:availability',
] as const

export function cloudbedsAuthorizeUrl(params: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(`${OAUTH_BASE}/oauth`)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CLOUDBEDS_SCOPES.join(' '))
  url.searchParams.set('state', params.state)
  return url.toString()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function readBoolean(source: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1 || value === '1') return true
    if (value === 'false' || value === 0 || value === '0') return false
  }
  return null
}

/** 5xx and 429 are worth retrying; a 4xx means we sent something wrong. */
function isRetryableStatus(status: number) {
  return status === 429 || status >= 500
}

export class CloudbedsAdapter implements ChannelAdapter {
  readonly provider = 'CLOUDBEDS' as const
  private readonly clientId: string
  private readonly clientSecret: string

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  private async request<T = unknown>(
    credentials: ChannelCredentials,
    method: string,
    init: { httpMethod?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = new URL(`${API_BASE}/${method}`)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: init.httpMethod ?? 'GET',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (cause) {
      // Network failures and timeouts are transient by nature.
      throw new ChannelApiError(`Cloudbeds ${method} did not respond`, null, true, { cause })
    }

    if (response.status === 401 || response.status === 403) {
      throw new ChannelAuthError(`Cloudbeds rejected the access token on ${method}`)
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      if (!response.ok) {
        throw new ChannelApiError(
          `Cloudbeds ${method} failed with ${response.status}`,
          response.status,
          isRetryableStatus(response.status),
        )
      }
      throw new ChannelApiError(`Cloudbeds ${method} returned a non-JSON body`, response.status, false)
    }

    const envelope = asRecord(parsed)
    if (!response.ok) {
      const message = readString(envelope, 'message', 'error', 'error_description') ?? `HTTP ${response.status}`
      throw new ChannelApiError(
        `Cloudbeds ${method} failed: ${message}`,
        response.status,
        isRetryableStatus(response.status),
      )
    }

    // Cloudbeds wraps most responses as { success: boolean, data: ... }. A success:false
    // with HTTP 200 is a real failure and must not be read as an empty result set.
    if (envelope.success === false) {
      const message = readString(envelope, 'message', 'error') ?? 'request was rejected'
      throw new ChannelApiError(`Cloudbeds ${method} failed: ${message}`, response.status, false)
    }

    return (envelope.data !== undefined ? envelope.data : parsed) as T
  }

  private async tokenRequest(body: Record<string, string>): Promise<ChannelTokenSet> {
    let response: Response
    try {
      response = await fetch(`${OAUTH_BASE}/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (cause) {
      throw new ChannelApiError('Cloudbeds token endpoint did not respond', null, true, { cause })
    }

    const payload = asRecord(await response.json().catch(() => null))
    if (!response.ok) {
      const message = readString(payload, 'error_description', 'error', 'message') ?? `HTTP ${response.status}`
      throw new ChannelApiError(`Cloudbeds token request failed: ${message}`, response.status, isRetryableStatus(response.status))
    }

    const accessToken = readString(payload, 'access_token')
    const refreshToken = readString(payload, 'refresh_token')
    if (!accessToken || !refreshToken) {
      throw new ChannelApiError('Cloudbeds token response was missing a token', response.status, false)
    }

    // Documented as 8 hours; trust the response when present, and subtract a safety
    // margin so we refresh before a request can fail mid-flight.
    const expiresInSeconds = readNumber(payload, 'expires_in') ?? 28_800
    const safetyMarginSeconds = 300
    const scopeValue = readString(payload, 'scope')

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + Math.max(60, expiresInSeconds - safetyMarginSeconds) * 1000),
      scopes: scopeValue ? scopeValue.split(/[\s,]+/).filter(Boolean) : [...CLOUDBEDS_SCOPES],
    }
  }

  exchangeAuthorizationCode(code: string, redirectUri: string) {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  }

  refreshCredentials(refreshToken: string) {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  async listProperties(credentials: ChannelCredentials): Promise<ExternalProperty[]> {
    const data = await this.request(credentials, 'getHotels')
    return asArray(Array.isArray(data) ? data : asRecord(data).hotels).map(entry =>
      normaliseProperty(asRecord(entry)),
    )
  }

  async getProperty(credentials: ChannelCredentials, externalPropertyId: string): Promise<ExternalProperty> {
    const data = await this.request(credentials, 'getHotelDetails', { query: { propertyID: externalPropertyId } })
    const record = asRecord(Array.isArray(data) ? data[0] : data)
    if (Object.keys(record).length === 0) {
      throw new ChannelApiError(`Cloudbeds returned no property for ${externalPropertyId}`, null, false)
    }
    return normaliseProperty(record, externalPropertyId)
  }

  async listRoomTypes(credentials: ChannelCredentials, externalPropertyId: string): Promise<ExternalRoomType[]> {
    const [roomTypeData, ratePlanData] = await Promise.all([
      this.request(credentials, 'getRoomTypes', { query: { propertyID: externalPropertyId } }),
      // Rate plans are best-effort: a property may expose none, and a missing rate plan
      // should degrade to the room type's own rate rather than abort the whole import.
      this.request(credentials, 'getRatePlans', { query: { propertyID: externalPropertyId } }).catch(() => null),
    ])

    const rateByRoomType = new Map<string, { ratePlanId: string | null; rate: number | null }>()
    for (const entry of asArray(Array.isArray(ratePlanData) ? ratePlanData : asRecord(ratePlanData).ratePlans)) {
      const record = asRecord(entry)
      const roomTypeId = readString(record, 'roomTypeID', 'roomTypeId')
      if (!roomTypeId || rateByRoomType.has(roomTypeId)) continue
      rateByRoomType.set(roomTypeId, {
        ratePlanId: readString(record, 'ratePlanID', 'ratePlanId', 'rateID'),
        rate: readNumber(record, 'rate', 'ratePlanRate', 'totalRate'),
      })
    }

    return asArray(Array.isArray(roomTypeData) ? roomTypeData : asRecord(roomTypeData).roomTypes).flatMap(entry => {
      const record = asRecord(entry)
      const id = readString(record, 'roomTypeID', 'roomTypeId', 'id')
      if (!id) return []
      const ratePlan = rateByRoomType.get(id)
      return [{
        externalRoomTypeId: id,
        externalRatePlanId: ratePlan?.ratePlanId ?? null,
        name: readString(record, 'roomTypeName', 'name') ?? 'Room',
        description: readString(record, 'roomTypeDescription', 'description'),
        unitCount: readNumber(record, 'roomsAvailable', 'totalRooms', 'roomTypeUnits', 'units') ?? 1,
        maxOccupancy: readNumber(record, 'maxGuests', 'roomTypeMaxOccupancy', 'maxOccupancy') ?? 2,
        nightlyRate: ratePlan?.rate ?? readNumber(record, 'roomRate', 'rate', 'defaultRate') ?? 0,
        amenities: asArray(record.roomTypeFeatures ?? record.amenities)
          .map(item => (typeof item === 'string' ? item : readString(asRecord(item), 'name', 'featureName') ?? ''))
          .filter(Boolean),
        imageUrls: asArray(record.roomTypePhotos ?? record.images)
          .map(item => (typeof item === 'string' ? item : readString(asRecord(item), 'url', 'image') ?? ''))
          .filter(Boolean),
      }]
    })
  }

  async getAvailability(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExternalAvailability[]> {
    const data = await this.request(credentials, 'getAvailableRoomTypes', {
      query: { propertyID: externalPropertyId, startDate, endDate, detailedRates: 'true' },
    })

    const results: ExternalAvailability[] = []
    // Shape varies: either a flat list of per-date rows, or per-property groups each
    // holding room types with a nested date breakdown. Handle both.
    for (const propertyEntry of asArray(Array.isArray(data) ? data : asRecord(data).propertyRooms ?? [data])) {
      const propertyRecord = asRecord(propertyEntry)
      const roomTypes = asArray(propertyRecord.rooms ?? propertyRecord.roomTypes ?? [propertyRecord])

      for (const roomTypeEntry of roomTypes) {
        const roomTypeRecord = asRecord(roomTypeEntry)
        const roomTypeId = readString(roomTypeRecord, 'roomTypeID', 'roomTypeId', 'id')
        if (!roomTypeId) continue

        const dateRows = asArray(roomTypeRecord.roomsAvailableByDate ?? roomTypeRecord.dates ?? roomTypeRecord.rates)
        if (dateRows.length === 0) {
          const date = readString(roomTypeRecord, 'date')
          if (!date) continue
          results.push(availabilityRow(roomTypeId, date, roomTypeRecord))
          continue
        }

        for (const dateEntry of dateRows) {
          const dateRecord = asRecord(dateEntry)
          const date = readString(dateRecord, 'date')
          if (!date) continue
          results.push(availabilityRow(roomTypeId, date, dateRecord))
        }
      }
    }
    return results
  }

  async createReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    request: ExternalReservationRequest,
  ): Promise<ExternalReservation> {
    const [firstName, ...restName] = request.guestName.trim().split(/\s+/)
    const data = await this.request(credentials, 'postReservation', {
      httpMethod: 'POST',
      body: {
        propertyID: externalPropertyId,
        // The idempotency key. A retry with the same value must not create a second
        // reservation - this is what makes push-with-backoff safe after a payment.
        thirdPartyIdentifier: request.idempotencyKey,
        startDate: request.checkInDate,
        endDate: request.checkOutDate,
        guestFirstName: firstName || 'Guest',
        guestLastName: restName.join(' ') || 'Guest',
        guestEmail: request.guestEmail,
        guestPhone: request.guestPhone,
        guestCountry: 'IN',
        paymentMethod: 'cash',
        rooms: [{
          roomTypeID: request.externalRoomTypeId,
          quantity: request.roomCount,
          ...(request.externalRatePlanId ? { ratePlanID: request.externalRatePlanId } : {}),
        }],
        adults: [{ roomTypeID: request.externalRoomTypeId, quantity: request.guestCount }],
        children: [{ roomTypeID: request.externalRoomTypeId, quantity: 0 }],
      },
    })

    const record = asRecord(data)
    const reservationId = readString(record, 'reservationID', 'reservationId', 'id')
    if (!reservationId) {
      // Non-retryable: the call reported success but gave us nothing to reconcile
      // against, so retrying risks creating a duplicate we cannot see.
      throw new ChannelApiError('Cloudbeds accepted the reservation but returned no id', null, false)
    }

    return {
      externalReservationId: reservationId,
      status: 'CONFIRMED',
      externalRoomTypeId: request.externalRoomTypeId,
      checkInDate: request.checkInDate,
      checkOutDate: request.checkOutDate,
      roomCount: request.roomCount,
    }
  }

  async cancelReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    externalReservationId: string,
  ): Promise<void> {
    await this.request(credentials, 'putReservation', {
      httpMethod: 'POST',
      body: { propertyID: externalPropertyId, reservationID: externalReservationId, status: 'canceled' },
    })
  }

  async getReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    externalReservationId: string,
  ): Promise<ExternalReservation | null> {
    const data = await this.request(credentials, 'getReservation', {
      query: { propertyID: externalPropertyId, reservationID: externalReservationId },
    }).catch(error => {
      if (error instanceof ChannelApiError && error.status === 404) return null
      throw error
    })
    if (!data) return null

    const record = asRecord(Array.isArray(data) ? data[0] : data)
    const id = readString(record, 'reservationID', 'reservationId', 'id')
    if (!id) return null

    return {
      externalReservationId: id,
      status: normaliseReservationStatus(readString(record, 'status', 'reservationStatus')),
      externalRoomTypeId: readString(record, 'roomTypeID', 'roomTypeId'),
      checkInDate: readString(record, 'startDate', 'checkIn'),
      checkOutDate: readString(record, 'endDate', 'checkOut'),
      roomCount: readNumber(record, 'roomsCount', 'quantity') ?? 1,
    }
  }

  /**
   * Normalises a webhook delivery into "something of this kind changed".
   *
   * Cloudbeds documents no signature, so nothing in the payload is trustworthy as
   * state and none of it is written to the database. Callers re-read authoritative
   * state from the API instead, which also makes the documented out-of-order delivery
   * harmless. The only fields used are routing hints and a dedupe key.
   */
  parseWebhookEvent(payload: unknown): ChannelWebhookEvent | null {
    const record = asRecord(payload)
    const event = readString(record, 'event')
    if (!event) return null

    const [object] = event.split('/')
    const kind =
      object === 'reservation' ? 'RESERVATION_CHANGED' as const
      : object === 'availability' || event.includes('closeout') ? 'AVAILABILITY_CHANGED' as const
      : 'UNKNOWN' as const

    const propertyId = readString(record, 'propertyID', 'propertyId')
    const reservationId = readString(record, 'reservationID', 'reservationId')
    const timestamp = readNumber(record, 'timestamp')

    return {
      // Deliveries retry up to five times; this key is what makes reprocessing a no-op.
      eventKey: [this.provider, propertyId ?? 'unknown', event, reservationId ?? '', timestamp ?? '']
        .join(':')
        .slice(0, 255),
      kind,
      externalPropertyId: propertyId,
      externalReservationId: reservationId,
      externalRoomTypeId: readString(record, 'roomTypeID', 'roomTypeId'),
      occurredAt: timestamp ? new Date(timestamp * 1000) : null,
    }
  }
}

function availabilityRow(roomTypeId: string, date: string, record: Record<string, unknown>): ExternalAvailability {
  const closed = readBoolean(record, 'isClosed', 'closed', 'closedToArrival') ?? false
  return {
    externalRoomTypeId: roomTypeId,
    date,
    unitsAvailable: readNumber(record, 'roomsAvailable', 'available', 'availability', 'quantity') ?? 0,
    closed,
    nightlyRate: readNumber(record, 'rate', 'roomRate', 'totalRate'),
  }
}

function normaliseReservationStatus(status: string | null): ExternalReservation['status'] {
  if (!status) return 'UNKNOWN'
  const lowered = status.toLowerCase()
  if (lowered.includes('cancel')) return 'CANCELLED'
  if (lowered === 'confirmed' || lowered === 'checked_in' || lowered === 'checked_out' || lowered === 'not_confirmed') {
    return 'CONFIRMED'
  }
  return 'UNKNOWN'
}

function normaliseProperty(record: Record<string, unknown>, fallbackId?: string): ExternalProperty {
  const id = readString(record, 'propertyID', 'propertyId', 'id') ?? fallbackId
  if (!id) throw new ChannelApiError('Cloudbeds property is missing an id', null, false)

  return {
    externalPropertyId: id,
    name: readString(record, 'propertyName', 'name') ?? '',
    description: readString(record, 'propertyDescription', 'description'),
    address: readString(record, 'propertyAddress1', 'address1', 'address'),
    city: readString(record, 'propertyCity', 'city'),
    state: readString(record, 'propertyState', 'state'),
    country: readString(record, 'propertyCountry', 'country'),
    postalCode: readString(record, 'propertyZip', 'zip', 'postalCode'),
    latitude: readNumber(record, 'propertyLatitude', 'latitude', 'lat'),
    longitude: readNumber(record, 'propertyLongitude', 'longitude', 'lng'),
    currency:
      readString(asRecord(record.propertyCurrency), 'currencyCode')
      ?? readString(record, 'currencyCode', 'currency')
      ?? '',
    timezone: readString(record, 'propertyTimezone', 'timezone', 'timeZone') ?? '',
    checkInTime: readString(record, 'propertyCheckIn', 'checkInTime', 'checkIn'),
    checkOutTime: readString(record, 'propertyCheckOut', 'checkOutTime', 'checkOut'),
    amenities: asArray(record.propertyAmenities ?? record.amenities)
      .map(item => (typeof item === 'string' ? item : readString(asRecord(item), 'name', 'amenityName') ?? ''))
      .filter(Boolean),
    imageUrls: asArray(record.propertyImage ?? record.images)
      .map(item => (typeof item === 'string' ? item : readString(asRecord(item), 'url', 'image') ?? ''))
      .filter(Boolean),
  }
}
