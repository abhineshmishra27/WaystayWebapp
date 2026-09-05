import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeHolds,
  dateWindow,
  isUsableCoordinate,
  isValidDateString,
  roundRate,
  toHotelFields,
  toRoomFields,
  validatePropertyForImport,
} from '../src/lib/channels/mapping.ts'
import type { ExternalAvailability, ExternalProperty, ExternalRoomType } from '../src/lib/channels/types.ts'

function property(overrides: Partial<ExternalProperty> = {}): ExternalProperty {
  return {
    externalPropertyId: 'cb-1',
    name: 'Sunrise Residency',
    description: 'A calm stay near the airport.',
    address: '12 Airport Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560300',
    latitude: 13.1986,
    longitude: 77.7066,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    checkInTime: '14:00',
    checkOutTime: '11:00',
    amenities: ['WiFi', 'Parking'],
    imageUrls: [],
    ...overrides,
  }
}

function roomType(overrides: Partial<ExternalRoomType> = {}): ExternalRoomType {
  return {
    externalRoomTypeId: 'rt-1',
    externalRatePlanId: 'rp-1',
    name: 'Deluxe Queen',
    description: 'Queen bed, city view.',
    unitCount: 4,
    maxOccupancy: 2,
    nightlyRate: 3200,
    amenities: ['AC'],
    imageUrls: ['https://example.test/a.jpg'],
    ...overrides,
  }
}

test('a well-formed INR property passes validation', () => {
  assert.deepEqual(validatePropertyForImport(property()), [])
})

test('a non-INR property is rejected rather than silently mispriced', () => {
  const rejections = validatePropertyForImport(property({ currency: 'USD' }))
  assert.equal(rejections.length, 1)
  assert.equal(rejections[0].reason, 'UNSUPPORTED_CURRENCY')
})

test('a property in another timezone is rejected', () => {
  const rejections = validatePropertyForImport(property({ timezone: 'America/New_York' }))
  assert.equal(rejections[0].reason, 'UNSUPPORTED_TIMEZONE')
})

test('a property without usable coordinates is rejected - it could never be found', () => {
  const rejections = validatePropertyForImport(property({ latitude: 0, longitude: 0 }))
  assert.equal(rejections[0].reason, 'MISSING_COORDINATES')
  assert.equal(isUsableCoordinate(0, 0), false)
  assert.equal(isUsableCoordinate(null, 77.7), false)
  assert.equal(isUsableCoordinate(91, 77.7), false)
  assert.equal(isUsableCoordinate(13.19, 77.7), true)
})

test('several problems are reported together, not one at a time', () => {
  const rejections = validatePropertyForImport(
    property({ name: '   ', currency: 'EUR', latitude: null, longitude: null }),
  )
  assert.deepEqual(rejections.map(r => r.reason).sort(), [
    'MISSING_COORDINATES',
    'MISSING_NAME',
    'UNSUPPORTED_CURRENCY',
  ])
})

test('hotel fields are normalised and never inherit an external rating', () => {
  const fields = toHotelFields(property({ name: '  Sunrise   Residency  ' }))
  assert.equal(fields.name, 'Sunrise Residency')
  assert.equal(fields.rating_avg, 0)
  assert.equal(fields.total_review, 0)
  assert.equal(fields.checkInTime, '14:00')
})

test('missing check-in times fall back to WayStay defaults', () => {
  const fields = toHotelFields(property({ checkInTime: null, checkOutTime: '11:00:00' }))
  assert.equal(fields.checkInTime, '12:00')
  assert.equal(fields.checkOutTime, '11:00')
})

test('a missing description gets a real sentence, not an empty string', () => {
  const fields = toHotelFields(property({ description: null }))
  assert.ok(fields.description.includes('Sunrise Residency'))
  assert.ok(fields.description.length > 0)
})

test('duplicate amenities are collapsed case-insensitively', () => {
  const fields = toHotelFields(property({ amenities: ['WiFi', 'wifi', ' Parking ', ''] }))
  assert.deepEqual(fields.amenities, ['WiFi', 'Parking'])
})

test('imported rooms are night-only with no invented hourly prices', () => {
  const fields = toRoomFields(roomType())
  assert.equal(fields.priceFullDay, 3200)
  assert.equal(fields.nightStayEnabled, true)
  assert.equal(fields.threeHourEnabled, false)
  assert.equal(fields.sixHourEnabled, false)
  assert.equal(fields.twelveHourEnabled, false)
  assert.equal(fields.price_3h, 0)
  assert.equal(fields.pricePerHour, 0)
})

test('room inventory and occupancy are floored to at least one', () => {
  const fields = toRoomFields(roomType({ unitCount: 0, maxOccupancy: 0 }))
  assert.equal(fields.inventoryCount, 1)
  assert.equal(fields.maxOccupancy, 1)
})

test('rates are rounded to paise and never negative', () => {
  assert.equal(roundRate(1234.567), 1234.57)
  assert.equal(roundRate(-5), 0)
  assert.equal(roundRate(Number.NaN), 0)
})

test('holds are the difference between total units and units still for sale', () => {
  const availability: ExternalAvailability[] = [
    { externalRoomTypeId: 'rt-1', date: '2026-09-10', unitsAvailable: 1, closed: false, nightlyRate: 3200 },
  ]
  assert.deepEqual(computeHolds(availability, new Map([['rt-1', 4]])), [
    { externalRoomTypeId: 'rt-1', date: '2026-09-10', unitsHeld: 3 },
  ])
})

test('a closed date holds the whole room regardless of reported units', () => {
  const availability: ExternalAvailability[] = [
    { externalRoomTypeId: 'rt-1', date: '2026-09-10', unitsAvailable: 3, closed: true, nightlyRate: null },
  ]
  assert.deepEqual(computeHolds(availability, new Map([['rt-1', 4]])), [
    { externalRoomTypeId: 'rt-1', date: '2026-09-10', unitsHeld: 4 },
  ])
})

test('a provider claiming more availability than exists cannot create negative holds', () => {
  const availability: ExternalAvailability[] = [
    { externalRoomTypeId: 'rt-1', date: '2026-09-10', unitsAvailable: 99, closed: false, nightlyRate: null },
    { externalRoomTypeId: 'rt-1', date: '2026-09-11', unitsAvailable: -3, closed: false, nightlyRate: null },
  ]
  const holds = computeHolds(availability, new Map([['rt-1', 2]]))
  assert.equal(holds[0].unitsHeld, 0)
  // Nonsense negative availability is treated as "nothing for sale", the safe direction.
  assert.equal(holds[1].unitsHeld, 2)
})

test('availability for an unmapped room type is ignored', () => {
  const availability: ExternalAvailability[] = [
    { externalRoomTypeId: 'unknown', date: '2026-09-10', unitsAvailable: 0, closed: false, nightlyRate: null },
  ]
  assert.deepEqual(computeHolds(availability, new Map([['rt-1', 4]])), [])
})

test('malformed dates are dropped instead of poisoning the calendar', () => {
  const availability: ExternalAvailability[] = [
    { externalRoomTypeId: 'rt-1', date: '2026-02-31', unitsAvailable: 0, closed: false, nightlyRate: null },
    { externalRoomTypeId: 'rt-1', date: '10-09-2026', unitsAvailable: 0, closed: false, nightlyRate: null },
  ]
  assert.deepEqual(computeHolds(availability, new Map([['rt-1', 4]])), [])
  assert.equal(isValidDateString('2026-02-31'), false)
  assert.equal(isValidDateString('2026-02-28'), true)
})

test('date windows are inclusive and cross month boundaries', () => {
  assert.deepEqual(dateWindow('2026-08-30', 3), ['2026-08-30', '2026-08-31', '2026-09-01'])
  assert.deepEqual(dateWindow('nonsense', 3), [])
  assert.deepEqual(dateWindow('2026-08-30', 0), [])
})
