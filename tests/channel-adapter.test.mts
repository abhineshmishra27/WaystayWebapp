import test from 'node:test'
import assert from 'node:assert/strict'

process.env.CLOUDBEDS_CLIENT_ID ??= 'test-client'
process.env.CLOUDBEDS_CLIENT_SECRET ??= 'test-secret'

const { CloudbedsAdapter, cloudbedsAuthorizeUrl } = await import('../src/lib/channels/cloudbeds.ts')

const adapter = new CloudbedsAdapter('test-client', 'test-secret')

test('the authorize URL carries the client, redirect, scopes and state', () => {
  const url = new URL(
    cloudbedsAuthorizeUrl({
      clientId: 'abc',
      redirectUri: 'https://waystay.test/api/channels/cloudbeds/callback',
      state: 'signed-state',
    }),
  )
  assert.equal(url.searchParams.get('client_id'), 'abc')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('state'), 'signed-state')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://waystay.test/api/channels/cloudbeds/callback')
  assert.ok(url.searchParams.get('scope')?.includes('write:reservation'))
})

test('a reservation webhook is normalised and given a dedupe key', () => {
  const event = adapter.parseWebhookEvent({
    version: '1.0',
    event: 'reservation/created',
    timestamp: 1789000000,
    propertyID: '12345',
    reservationID: 'res-1',
  })
  assert.equal(event?.kind, 'RESERVATION_CHANGED')
  assert.equal(event?.externalPropertyId, '12345')
  assert.equal(event?.externalReservationId, 'res-1')
  assert.ok(event?.eventKey.includes('reservation/created'))
})

test('redeliveries of the same event produce the same dedupe key', () => {
  const payload = { event: 'reservation/status_changed', timestamp: 1789000001, propertyID: '1', reservationID: 'r9' }
  assert.equal(adapter.parseWebhookEvent(payload)?.eventKey, adapter.parseWebhookEvent({ ...payload })?.eventKey)
})

test('distinct events do not collide on the dedupe key', () => {
  const first = adapter.parseWebhookEvent({ event: 'reservation/created', timestamp: 1, propertyID: '1', reservationID: 'a' })
  const second = adapter.parseWebhookEvent({ event: 'reservation/created', timestamp: 1, propertyID: '1', reservationID: 'b' })
  assert.notEqual(first?.eventKey, second?.eventKey)
})

test('availability closeout events are recognised as availability changes', () => {
  const event = adapter.parseWebhookEvent({ event: 'availability/closeout_changed', timestamp: 2, propertyID: '1' })
  assert.equal(event?.kind, 'AVAILABILITY_CHANGED')
})

test('an unrecognised event is kept but marked unknown rather than dropped silently', () => {
  const event = adapter.parseWebhookEvent({ event: 'housekeeping/room_cleaned', timestamp: 3, propertyID: '1' })
  assert.equal(event?.kind, 'UNKNOWN')
})

test('a payload with no event field is rejected', () => {
  assert.equal(adapter.parseWebhookEvent({ propertyID: '1' }), null)
  assert.equal(adapter.parseWebhookEvent(null), null)
  assert.equal(adapter.parseWebhookEvent('not-an-object'), null)
})

test('the dedupe key stays within the column bound for absurd payloads', () => {
  const event = adapter.parseWebhookEvent({
    event: 'reservation/created',
    timestamp: 1,
    propertyID: 'x'.repeat(500),
    reservationID: 'y'.repeat(500),
  })
  assert.ok((event?.eventKey.length ?? 0) <= 255)
})
