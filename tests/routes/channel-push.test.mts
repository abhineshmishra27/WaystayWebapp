import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seedFixtures, setupTestDatabase, teardownTestDatabase, type TestFixtures } from '../support/route-harness.mts'
import { createCloudbedsFake, FAKE_PROPERTY_ID } from '../support/cloudbeds-fake.mjs'

/**
 * Pushing WayStay bookings out to the channel.
 *
 * This is what makes the integration two-way. Without it WayStay sells imported
 * inventory and the partner keeps offering the same room, which is the double sale the
 * whole design exists to prevent - so the cases that matter here are the failure ones:
 * a push that fails must never cost the guest their booking, and a retry must never
 * create a second reservation.
 */

let fixtures: TestFixtures
let fake: ReturnType<typeof createCloudbedsFake>
let sync: typeof import('@/lib/channels/sync')

before(async () => {
  await setupTestDatabase()
  fixtures = await seedFixtures()

  fake = createCloudbedsFake()
  const bases = await fake.listen()
  process.env.CLOUDBEDS_API_BASE = bases.apiBase
  process.env.CLOUDBEDS_OAUTH_BASE = bases.oauthBase
  process.env.CLOUDBEDS_CLIENT_ID = 'fake-client'
  process.env.CLOUDBEDS_CLIENT_SECRET = 'fake-secret'

  const { prisma } = await import('@/lib/db')
  const { encryptSecret } = await import('@/lib/crypto')
  sync = await import('@/lib/channels/sync')

  // Point the seeded connection at the fake property so the adapter can reach it.
  await prisma.channelConnection.update({
    where: { id: fixtures.connectionId },
    data: {
      externalPropertyId: FAKE_PROPERTY_ID,
      accessTokenEnc: encryptSecret('seed-access'),
      refreshTokenEnc: encryptSecret('seed-refresh'),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    },
  })
})

after(async () => {
  await fake?.close()
  await teardownTestDatabase()
})

async function makeBooking(roomId: string) {
  const { prisma } = await import('@/lib/db')
  const slot = await prisma.roomSlot.findFirstOrThrow({ where: { roomId, date: fixtures.stayDate } })
  return prisma.booking.create({
    data: {
      customerId: fixtures.customerId,
      roomSlotId: slot.id,
      checkIn: new Date(`${fixtures.stayDate}T12:00:00Z`),
      checkOut: new Date(`${fixtures.nextDate}T11:00:00Z`),
      totalHours: 24,
      totalAmount: 2000,
      guestName: 'Push Test',
      guestEmail: 'push@waystay.test',
      guestPhone: '9999999999',
      guestCount: 1,
      roomCount: 1,
      status: 'CONFIRMED',
    },
  })
}

async function reset() {
  const { prisma } = await import('@/lib/db')
  await prisma.channelBookingMapping.deleteMany({})
  await prisma.booking.deleteMany({})
  fake.state.reservationsByKey.clear()
  fake.state.reservationRequests.length = 0
  fake.state.cancelled.length = 0
}

test('a booking on an ordinary hotel is not pushed anywhere', async () => {
  await reset()
  const booking = await makeBooking(fixtures.roomId)
  const result = await sync.pushBookingToChannel(booking.id)

  assert.equal(result.status, 'SKIPPED')
  assert.equal(fake.state.reservationRequests.length, 0, 'no provider call for a non-channel hotel')
})

test('a channel booking is pushed with the booking id as the idempotency key', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  const result = await sync.pushBookingToChannel(booking.id)

  assert.equal(result.status, 'PUSHED')
  // The fake is plain JavaScript, so its captured requests carry no type information.
  const sent = fake.state.reservationRequests[0] as unknown as {
    thirdPartyIdentifier: string
    propertyID: string
    startDate: string
  }
  // This is what makes every retry safe.
  assert.equal(sent.thirdPartyIdentifier, booking.id)
  assert.equal(sent.propertyID, FAKE_PROPERTY_ID)
  assert.equal(sent.startDate, fixtures.stayDate)

  const { prisma } = await import('@/lib/db')
  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  assert.equal(mapping.pushStatus, 'PUSHED')
  assert.ok(mapping.externalReservationId)
})

test('pushing the same booking twice does not create a second reservation', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  const first = await sync.pushBookingToChannel(booking.id)
  const second = await sync.pushBookingToChannel(booking.id)

  assert.deepEqual(first, second)
  assert.equal(fake.state.reservationsByKey.size, 1)
  // The second call short-circuits on the stored mapping without reaching the provider.
  assert.equal(fake.state.reservationRequests.length, 1)
})

test('a failed push keeps the guest booking and schedules a retry', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  fake.state.failNextReservation = true

  const result = await sync.pushBookingToChannel(booking.id)
  assert.equal(result.status, 'FAILED')

  const { prisma } = await import('@/lib/db')
  // The guest paid; losing their room because a partner's API blinked is not acceptable.
  const stillThere = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  assert.equal(stillThere.status, 'CONFIRMED')

  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  assert.equal(mapping.pushStatus, 'FAILED')
  assert.equal(mapping.pushAttempts, 1)
  assert.ok(mapping.nextRetryAt, 'a retry must be scheduled')
  assert.ok(mapping.lastPushError)
})

test('a due retry succeeds and creates exactly one reservation', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  fake.state.failNextReservation = true
  await sync.pushBookingToChannel(booking.id)

  const { prisma } = await import('@/lib/db')
  // Bring the retry forward rather than waiting out the backoff.
  await prisma.channelBookingMapping.update({
    where: { bookingId: booking.id },
    data: { nextRetryAt: new Date(Date.now() - 1000) },
  })

  const outcome = await sync.retryDuePushes()
  assert.equal(outcome.attempted, 1)
  assert.equal(outcome.pushed, 1)
  assert.equal(fake.state.reservationsByKey.size, 1, 'the failed attempt left nothing behind to duplicate')

  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  assert.equal(mapping.pushStatus, 'PUSHED')
  assert.equal(mapping.nextRetryAt, null)
})

test('a retry that is not yet due is left alone', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  fake.state.failNextReservation = true
  await sync.pushBookingToChannel(booking.id)

  const outcome = await sync.retryDuePushes()
  assert.equal(outcome.attempted, 0, 'backoff must actually hold the retry back')
})

test('an accepted reservation with no id is not retried into a duplicate', async () => {
  // The provider says success but gives nothing to reconcile against. Retrying could
  // create a second reservation we cannot see, so the adapter treats it as terminal.
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  fake.state.reservationReturnsNoId = true

  const result = await sync.pushBookingToChannel(booking.id)
  assert.equal(result.status, 'FAILED')
  fake.state.reservationReturnsNoId = false
})

test('exhausting the attempt limit abandons the push instead of retrying forever', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  const { prisma } = await import('@/lib/db')

  // One attempt short of the limit, so the next failure is the last.
  fake.state.failNextReservation = true
  await sync.pushBookingToChannel(booking.id)
  await prisma.channelBookingMapping.update({
    where: { bookingId: booking.id },
    data: { pushAttempts: 5, nextRetryAt: new Date(Date.now() - 1000) },
  })

  fake.state.failNextReservation = true
  const result = await sync.pushBookingToChannel(booking.id)
  assert.equal(result.status, 'ABANDONED')

  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  assert.equal(mapping.nextRetryAt, null, 'an abandoned push must stop being retried')

  // And it stays abandoned rather than quietly resuming.
  const again = await sync.pushBookingToChannel(booking.id)
  assert.equal(again.status, 'SKIPPED')
})

test('cancelling a pushed booking releases the room on the channel', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  await sync.pushBookingToChannel(booking.id)

  const result = await sync.cancelBookingOnChannel(booking.id)
  assert.equal(result.status, 'PUSHED')
  assert.equal(fake.state.cancelled.length, 1)

  const { prisma } = await import('@/lib/db')
  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  assert.equal(mapping.pushStatus, 'CANCELLED')
})

test('a cancellation the channel refused is recorded distinctly for chasing', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  await sync.pushBookingToChannel(booking.id)

  fake.state.failNextCancellation = true
  const result = await sync.cancelBookingOnChannel(booking.id)
  assert.equal(result.status, 'FAILED')

  const { prisma } = await import('@/lib/db')
  const mapping = await prisma.channelBookingMapping.findUniqueOrThrow({ where: { bookingId: booking.id } })
  // Not plain FAILED: the partner is still holding a room for a stay that is not
  // happening, which is a different problem from a push that never landed.
  assert.equal(mapping.pushStatus, 'CANCEL_FAILED')
})

test('cancelling something never pushed is a no-op', async () => {
  await reset()
  const booking = await makeBooking(fixtures.channelRoomId)
  const result = await sync.cancelBookingOnChannel(booking.id)

  assert.equal(result.status, 'SKIPPED')
  assert.equal(fake.state.cancelled.length, 0)
})
