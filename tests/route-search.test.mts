import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeGoogleEncodedPolyline,
  haversineKm,
  projectStopOntoPolyline,
  projectStopOntoRoute,
  routeCorridorKm,
} from '../src/lib/route-search.ts'

test('haversineKm calculates a realistic Delhi to Jaipur distance', () => {
  const distance = haversineKm(
    { latitude: 28.6139, longitude: 77.209 },
    { latitude: 26.9124, longitude: 75.7873 },
  )

  assert.ok(distance > 230 && distance < 240)
})

test('projectStopOntoRoute orders stops and measures detours', () => {
  const start = { latitude: 0, longitude: 0 }
  const end = { latitude: 0, longitude: 10 }
  const stop = { latitude: 1, longitude: 5 }
  const projection = projectStopOntoRoute(start, end, stop)

  assert.ok(Math.abs(projection.progress - 0.5) < 0.01)
  assert.ok(projection.detourKm > 110 && projection.detourKm < 112)
  assert.ok(projection.distanceFromStartKm > 550 && projection.distanceFromStartKm < 560)
})

test('routeCorridorKm expands for long routes but remains bounded', () => {
  assert.equal(routeCorridorKm(100), 25)
  assert.equal(routeCorridorKm(300), 36)
  assert.equal(routeCorridorKm(1000), 60)
})

test('Google route polylines decode into usable route geometry', () => {
  const points = decodeGoogleEncodedPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assert.deepEqual(points, [
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ])
})

test('projectStopOntoPolyline measures the nearest point on a curved route', () => {
  const projection = projectStopOntoPolyline(
    [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
    ],
    { latitude: 0.005, longitude: 0.5 },
  )

  assert.ok(projection.detourKm > 0.5 && projection.detourKm < 0.6)
  assert.ok(projection.distanceFromStartKm > 55 && projection.distanceFromStartKm < 56)
  assert.ok(projection.progress > 0.24 && projection.progress < 0.26)
})
