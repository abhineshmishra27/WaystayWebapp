import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  jsonRequest,
  seedFixtures,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from '../support/route-harness.mts'

/**
 * Route-level tests for POST /api/bookings against a real database.
 *
 * These cover the guards that actually broke during development: the duplicate-submit
 * guard silently answered a three-night request with a one-night booking, and the
 * channel pay-at-hotel refusal returned a 500 instead of a usable error. Both were found
 * by hand; neither could have been caught by a unit test, because both are about how the
 * handler behaves against real rows.
 *
 * Everything is imported dynamically: the harness has to put the test database in the
 * environment before src/lib/db.ts is loaded, and a static import here would connect to
 * the development database instead.
 */

let fixtures: TestFixtures
let postBooking: typeof import('@/app/api/bookings/route').POST
let setTestSession: (session: unknown) => void
let signedInAs: (user: { id: string; email: string; role?: 'ADMIN' | 'OWNER' | 'CUSTOMER' }) => unknown

before(async () => {
  await setupTestDatabase()
  fixtures = await seedFixtures()

  const authStub = await import('../support/auth-stub.mts')
  setTestSession = authStub.setTestSession as typeof setTestSession
  signedInAs = authStub.signedInAs as typeof signedInAs

  const route = await import('@/app/api/bookings/route')
  postBooking = route.POST

  setTestSession(signedInAs({ id: fixtures.customerId, email: 'route-test-customer@waystay.test' }))
})

after(async () => {
  await teardownTestDatabase()
})

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    slotId: fixtures.slotId,
    startDate: fixtures.stayDate,
    endDate: fixtures.nextDate,
    slotType: 'FULLDAY',
    guestName: 'Route Test Guest',
    guestEmail: 'route-test-customer@waystay.test',
    guestPhone: '9999999999',
    guestCount: 1,
    roomCount: 1,
    totalAmount: 2000,
    paymentMethod: 'PAY_AT_HOTEL',
    ...overrides,
  }
}

async function book(overrides: Record<string, unknown> = {}) {
  const response = await postBooking(await jsonRequest('http://localhost/api/bookings', bookingBody(overrides)))
  return { status: response.status, body: await response.json() }
}

async function clearBookings() {
  const { prisma } = await import('@/lib/db')
  await prisma.channelBookingMapping.deleteMany({})
  await prisma.payment.deleteMany({})
  await prisma.booking.deleteMany({})
}

test('a valid booking is created', async () => {
  await clearBookings()
  const result = await book()
  assert.equal(result.status, 201)
  assert.ok(result.body.bookingId)
})

test('an identical resubmission returns the original booking rather than a second one', async () => {
  await clearBookings()
  const first = await book()
  const second = await book()

  assert.equal(second.status, 201)
  assert.equal(second.body.bookingId, first.body.bookingId)

  const { prisma } = await import('@/lib/db')
  assert.equal(await prisma.booking.count(), 1, 'two submissions must leave one booking')
})

test('a longer stay is not answered with the shorter booking', async () => {
  // The regression that shipped: roomSlotId identifies only the first night, so
  // matching without the stay length handed a three-night request a one-night booking.
  await clearBookings()
  const oneNight = await book({ endDate: fixtures.nextDate })
  const threeNights = await book({
    endDate: new Date(Date.parse(`${fixtures.stayDate}T00:00:00Z`) + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10),
  })

  assert.notEqual(
    threeNights.body.bookingId,
    oneNight.body.bookingId,
    'a different stay length must never be treated as a duplicate',
  )
})

test('pay at hotel is refused for a channel-managed property, with a usable status', async () => {
  await clearBookings()
  const response = await postBooking(
    await jsonRequest(
      'http://localhost/api/bookings',
      bookingBody({ slotId: fixtures.channelSlotId, paymentMethod: 'PAY_AT_HOTEL' }),
    ),
  )
  const body = await response.json()

  // Previously a 500 with "Failed to create booking": the booking was correctly
  // refused, but the caller could not tell why.
  assert.equal(response.status, 400)
  assert.match(body.error, /online payment/i)

  const { prisma } = await import('@/lib/db')
  assert.equal(await prisma.booking.count(), 0, 'nothing may be created when the guard fires')
})

test('a room already booked for the night cannot be sold twice', async () => {
  await clearBookings()
  const first = await book()
  assert.equal(first.status, 201)

  // inventoryCount is 1, so a different guest count is a genuinely new request that
  // must fail on capacity rather than be deduped.
  const second = await book({ guestCount: 2, roomCount: 1 })
  assert.equal(second.status, 409)
  assert.match(second.body.error, /rooms are available|at least/i)
})

test('channel inventory holds reduce what WayStay can sell', async () => {
  await clearBookings()
  const { prisma } = await import('@/lib/db')

  // The room has one unit; holding it means the night is gone even with no bookings.
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.channelRoomId, date: fixtures.stayDate, unitsHeld: 1 },
  })

  const response = await postBooking(
    await jsonRequest(
      'http://localhost/api/bookings',
      bookingBody({ slotId: fixtures.channelSlotId, paymentMethod: 'RAZORPAY' }),
    ),
  )
  const body = await response.json()

  // Razorpay is deliberately unconfigured in tests, so a reachable room would answer
  // 503. Getting the capacity rejection instead proves the hold was applied.
  assert.equal(response.status, 409, `expected capacity rejection, got ${response.status}: ${JSON.stringify(body)}`)
  assert.match(body.error, /rooms are available/i)

  await prisma.channelInventoryHold.deleteMany({})
})

test('an unauthenticated request is rejected', async () => {
  setTestSession(null)
  const response = await postBooking(await jsonRequest('http://localhost/api/bookings', bookingBody()))
  assert.ok(response.status === 401 || response.status === 403, `expected 401/403, got ${response.status}`)
  setTestSession(signedInAs({ id: fixtures.customerId, email: 'route-test-customer@waystay.test' }))
})
