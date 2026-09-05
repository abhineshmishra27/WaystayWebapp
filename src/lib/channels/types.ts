/**
 * The contract every channel manager adapter implements.
 *
 * Boundary rule: an adapter speaks HTTP and the provider's payload shapes, and knows
 * nothing about Prisma. The orchestrator (sync.ts) owns transactions and persistence
 * and knows nothing about any provider's wire format. Anything that needs both belongs
 * in mapping.ts as a pure function. Keeping that line is what lets a second provider be
 * additive rather than a rewrite - and what lets sync be tested without a network.
 */

export type ChannelCredentials = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export type ChannelTokenSet = ChannelCredentials & {
  scopes: string[]
}

/** Provider-neutral description of a connected property. */
export type ExternalProperty = {
  externalPropertyId: string
  name: string
  description: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
  currency: string
  timezone: string
  checkInTime: string | null
  checkOutTime: string | null
  amenities: string[]
  imageUrls: string[]
}

export type ExternalRoomType = {
  externalRoomTypeId: string
  externalRatePlanId: string | null
  name: string
  description: string | null
  unitCount: number
  maxOccupancy: number
  /** Nightly rate in the property's currency. */
  nightlyRate: number
  amenities: string[]
  imageUrls: string[]
}

/** Availability for one room type on one date, in the property's local calendar. */
export type ExternalAvailability = {
  externalRoomTypeId: string
  date: string
  unitsAvailable: number
  /** Provider has explicitly closed this date for sale, regardless of unit count. */
  closed: boolean
  nightlyRate: number | null
}

export type ExternalReservationRequest = {
  externalRoomTypeId: string
  externalRatePlanId: string | null
  /** WayStay booking id, sent as the provider-side idempotency key. */
  idempotencyKey: string
  checkInDate: string
  checkOutDate: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount: number
  roomCount: number
  totalAmount: number
  currency: string
}

export type ExternalReservation = {
  externalReservationId: string
  status: 'CONFIRMED' | 'CANCELLED' | 'UNKNOWN'
  externalRoomTypeId: string | null
  checkInDate: string | null
  checkOutDate: string | null
  roomCount: number
}

/**
 * A webhook delivery, normalised. Payload contents are treated as an untrusted hint
 * that something changed - never as the new state. See `handleWebhookEvent`.
 */
export type ChannelWebhookEvent = {
  /** Stable identity for deduping redeliveries. */
  eventKey: string
  kind: 'RESERVATION_CHANGED' | 'AVAILABILITY_CHANGED' | 'UNKNOWN'
  externalPropertyId: string | null
  externalReservationId: string | null
  externalRoomTypeId: string | null
  occurredAt: Date | null
}

export class ChannelApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Whether retrying the same call could plausibly succeed. */
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ChannelApiError'
  }
}

/** Raised when the access token is rejected, so the caller can refresh and retry once. */
export class ChannelAuthError extends ChannelApiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 401, false, options)
    this.name = 'ChannelAuthError'
  }
}

export interface ChannelAdapter {
  readonly provider: 'CLOUDBEDS'

  /** Exchange an authorization code for the initial token set. */
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ChannelTokenSet>

  refreshCredentials(refreshToken: string): Promise<ChannelTokenSet>

  getProperty(credentials: ChannelCredentials, externalPropertyId: string): Promise<ExternalProperty>

  listProperties(credentials: ChannelCredentials): Promise<ExternalProperty[]>

  listRoomTypes(credentials: ChannelCredentials, externalPropertyId: string): Promise<ExternalRoomType[]>

  getAvailability(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExternalAvailability[]>

  createReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    request: ExternalReservationRequest,
  ): Promise<ExternalReservation>

  cancelReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    externalReservationId: string,
  ): Promise<void>

  getReservation(
    credentials: ChannelCredentials,
    externalPropertyId: string,
    externalReservationId: string,
  ): Promise<ExternalReservation | null>

  parseWebhookEvent(payload: unknown): ChannelWebhookEvent | null
}
