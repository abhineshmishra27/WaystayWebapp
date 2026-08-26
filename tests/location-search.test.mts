import test from 'node:test'
import assert from 'node:assert/strict'
import {
  descendantLocationIds,
  locationRadiusPlan,
  normalizeLocationQuery,
  resolveLocation,
  type SearchLocationCandidate,
} from '../src/lib/location-search.ts'

const locations: SearchLocationCandidate[] = [
  {
    id: 'bengaluru',
    name: 'Bengaluru',
    normalizedName: 'bengaluru',
    type: 'CITY',
    parentLocationId: null,
    latitude: 12.9716,
    longitude: 77.5946,
    radiusKm: 45,
    aliases: [
      { alias: 'Bangalore', normalizedAlias: 'bangalore' },
    ],
  },
  {
    id: 'koramangala',
    name: 'Koramangala',
    normalizedName: 'koramangala',
    type: 'LOCALITY',
    parentLocationId: 'bengaluru',
    latitude: 12.9352,
    longitude: 77.6245,
    radiusKm: 5,
    aliases: [
      { alias: '560034', normalizedAlias: '560034' },
    ],
  },
  {
    id: 'airport',
    name: 'Kempegowda International Airport',
    normalizedName: 'kempegowda international airport',
    type: 'AIRPORT',
    parentLocationId: 'bengaluru',
    latitude: 13.1986,
    longitude: 77.7066,
    radiusKm: 15,
    aliases: [
      { alias: 'Bangalore Airport', normalizedAlias: 'bangalore airport' },
    ],
  },
  {
    id: 'mumbai',
    name: 'Mumbai',
    normalizedName: 'mumbai',
    type: 'CITY',
    parentLocationId: null,
    latitude: 19.076,
    longitude: 72.8777,
    radiusKm: 40,
    aliases: [
      { alias: 'Bombay', normalizedAlias: 'bombay' },
    ],
  },
]

test('normalizes punctuation, spacing, accents, and case', () => {
  assert.equal(normalizeLocationQuery('  Béngaluru---Airport  '), 'bengaluru airport')
})

test('resolves canonical city names and historical aliases', () => {
  assert.equal(resolveLocation('Bengaluru', locations)?.location.id, 'bengaluru')
  assert.equal(resolveLocation('Bangalore', locations)?.location.id, 'bengaluru')
  assert.equal(resolveLocation('Bombay', locations)?.location.id, 'mumbai')
})

test('resolves common misspellings through fuzzy matching', () => {
  const result = resolveLocation('Banglore', locations)
  assert.equal(result?.location.id, 'bengaluru')
  assert.equal(result?.matchedBy, 'FUZZY')
})

test('resolves locality, postcode, and airport aliases', () => {
  assert.equal(resolveLocation('Koramangala', locations)?.location.id, 'koramangala')
  assert.equal(resolveLocation('560034', locations)?.location.id, 'koramangala')
  assert.equal(resolveLocation('Bangalore airport', locations)?.location.id, 'airport')
})

test('does not guess unknown numeric postcodes', () => {
  assert.equal(resolveLocation('560099', locations), null)
})

test('includes nested locations when searching a parent city', () => {
  assert.deepEqual(
    [...descendantLocationIds(locations, 'bengaluru')].sort(),
    ['airport', 'bengaluru', 'koramangala'],
  )
})

test('uses bounded radiuses by location type and expands predictably', () => {
  assert.deepEqual(locationRadiusPlan('LOCALITY', 5), { initialKm: 5, expandedKm: 10 })
  assert.deepEqual(locationRadiusPlan('LANDMARK', 10), { initialKm: 10, expandedKm: 20 })
  assert.deepEqual(locationRadiusPlan('AIRPORT', 15), { initialKm: 15, expandedKm: 30 })
  assert.deepEqual(locationRadiusPlan('CITY', 45), { initialKm: 45, expandedKm: 68 })
  assert.deepEqual(locationRadiusPlan('LOCALITY', 20), { initialKm: 7, expandedKm: 14 })
})
