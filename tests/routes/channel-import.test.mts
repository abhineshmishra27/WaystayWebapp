import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seedFixtures, setupTestDatabase, teardownTestDatabase, type TestFixtures } from '../support/route-harness.mts'
import { createCloudbedsFake, FAKE_PROPERTY_ID } from '../support/cloudbeds-fake.mjs'

/**
 * End-to-end validation of Phase B and C against a stand-in Cloudbeds.
 *
 * This exercises everything from a connection row to a bookable hotel with holds: the
 * adapter's HTTP layer, envelope handling, token refresh, the import, the availability
 * sync and the reconciliation it feeds. Real credentials would additionally prove the
 * field names are right; nothing here can, because the fake encodes the same guesses
 * the adapter does.
 */

let fixtures: TestFixtures
let fake: ReturnType<typeof createCloudbedsFake>
let connectionId: string
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

  const connection = await prisma.channelConnection.create({
    data: {
      provider: 'CLOUDBEDS',
      externalPropertyId: FAKE_PROPERTY_ID,
      ownerId: fixtures.ownerId,
      status: 'ACTIVE',
      currency: 'INR',
      accessTokenEnc: encryptSecret('seed-access-token'),
      refreshTokenEnc: encryptSecret('seed-refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      scopes: [],
    },
  })
  connectionId = connection.id
})

after(async () => {
  await fake?.close()
  await teardownTestDatabase()
})

test('importing creates a hotel that is complete enough to be sold', async () => {
  const result = await sync.importHotelFromConnection(connectionId)
  assert.equal(result.created, true)
  assert.equal(result.roomsUpserted, 2)

  const { prisma } = await import('@/lib/db')
  const hotel = await prisma.hotel.findUniqueOrThrow({
    where: { id: result.hotelId },
    include: { rooms: { orderBy: { name: 'asc' } } },
  })

  assert.equal(hotel.name, 'Fake Harbour Hotel')
  assert.equal(hotel.ownerId, fixtures.ownerId, 'belongs to the owner chosen at connect time')
  assert.equal(hotel.channelConnectionId, connectionId)
  // Third-party inventory is not trusted onto the storefront automatically.
  assert.equal(hotel.isApproved, false)
  // Nullable for imports: a foreign property has no Indian compliance numbers, and
  // placeholder values in those fields would be worse than an honest null.
  assert.equal(hotel.gst_number, null)
  assert.equal(hotel.license_number, null)
  // Without usable coordinates the hotel could never appear in radius search.
  assert.ok(Math.abs(hotel.lat - 12.9611) < 0.001)
  assert.deepEqual(hotel.amenities, ['WiFi', 'Parking'], 'duplicates collapsed case-insensitively')

  const standard = hotel.rooms.find(room => room.name === 'Standard Queen')!
  assert.ok(standard)
  // The rate plan wins over the room type's own rate.
  assert.equal(standard.priceFullDay, 2600)
  assert.equal(standard.inventoryCount, 3)
  // Night-only: inventing an hourly price for someone else's room would sell it at a
  // rate the property never agreed to.
  assert.equal(standard.nightStayEnabled, true)
  assert.equal(standard.threeHourEnabled, false)
  assert.equal(standard.price_3h, 0)
})

test('re-importing updates in place and never republishes', async () => {
  const { prisma } = await import('@/lib/db')
  const before = await prisma.hotel.findFirstOrThrow({ where: { channelConnectionId: connectionId } })

  // An admin approving the hotel is a decision a content refresh must not undo.
  await prisma.hotel.update({ where: { id: before.id }, data: { isApproved: true, rating_avg: 4.5 } })

  const again = await sync.importHotelFromConnection(connectionId)
  assert.equal(again.created, false)
  assert.equal(again.hotelId, before.id, 'no second hotel')

  const after = await prisma.hotel.findUniqueOrThrow({ where: { id: before.id } })
  assert.equal(after.isApproved, true, 'approval survives a re-sync')
  assert.equal(after.rating_avg, 4.5, "WayStay's own rating is not overwritten")

  assert.equal(
    await prisma.room.count({ where: { hotelId: before.id } }),
    2,
    're-import must not duplicate rooms',
  )
})

test('availability sync produces bookable nights and holds only where sold', async () => {
  const { prisma } = await import('@/lib/db')
  const outcome = await sync.syncAvailabilityWindow(connectionId, { days: 5 })

  assert.equal(outcome.rooms, 2)
  assert.equal(outcome.days, 5)
  assert.ok(outcome.slotsCreated > 0)

  const mapping = await prisma.channelRoomMapping.findFirstOrThrow({
    where: { connectionId, externalRoomTypeId: 'rt-standard' },
  })

  // Full-day only. Hourly slots for a channel room would advertise stays it cannot sell.
  const slots = await prisma.roomSlot.findMany({ where: { roomId: mapping.roomId } })
  assert.ok(slots.length > 0)
  assert.ok(slots.every(slot => slot.slotType === 'FULLDAY'), 'channel rooms get night slots only')

  // The fake reports all three units free, so nothing should be withheld.
  const holds = await prisma.channelInventoryHold.findMany({ where: { roomId: mapping.roomId } })
  assert.ok(holds.every(hold => hold.unitsHeld === 0), 'a fully available room holds nothing')
})

test('a date the channel has sold down is held, and released when it frees up', async () => {
  const { prisma } = await import('@/lib/db')
  const today = new Date().toISOString().slice(0, 10)

  // Two of three units gone on the channel side.
  fake.state.availabilityByDate = { [today]: 1 }
  await sync.syncAvailabilityWindow(connectionId, { days: 3 })

  const mapping = await prisma.channelRoomMapping.findFirstOrThrow({
    where: { connectionId, externalRoomTypeId: 'rt-standard' },
  })
  const held = await prisma.channelInventoryHold.findUniqueOrThrow({
    where: { roomId_date: { roomId: mapping.roomId, date: today } },
  })
  assert.equal(held.unitsHeld, 2, 'three units minus one still for sale')

  // Released on the channel: the hold must not linger and withhold sellable rooms.
  fake.state.availabilityByDate = {}
  await sync.syncAvailabilityWindow(connectionId, { days: 3 })
  const after = await prisma.channelInventoryHold.findUniqueOrThrow({
    where: { roomId_date: { roomId: mapping.roomId, date: today } },
  })
  assert.equal(after.unitsHeld, 0)
})

test('a closed date withholds the whole room regardless of unit count', async () => {
  const { prisma } = await import('@/lib/db')
  const today = new Date().toISOString().slice(0, 10)

  fake.state.availabilityByDate = { [today]: 'closed' }
  await sync.syncAvailabilityWindow(connectionId, { days: 3 })

  const mapping = await prisma.channelRoomMapping.findFirstOrThrow({
    where: { connectionId, externalRoomTypeId: 'rt-standard' },
  })
  const held = await prisma.channelInventoryHold.findUniqueOrThrow({
    where: { roomId_date: { roomId: mapping.roomId, date: today } },
  })
  assert.equal(held.unitsHeld, 3, 'closed means none of the units are sellable')

  fake.state.availabilityByDate = {}
})

test('an expired token is refreshed and the call retried, not failed', async () => {
  const { prisma } = await import('@/lib/db')
  const refreshesBefore = fake.state.refreshCount

  // Expire the stored token so the next operation must refresh before it can proceed.
  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { tokenExpiresAt: new Date(Date.now() - 1000) },
  })

  await sync.syncAvailabilityWindow(connectionId, { days: 2 })

  assert.ok(fake.state.refreshCount > refreshesBefore, 'a refresh was performed')
  const connection = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } })
  assert.ok(connection.tokenExpiresAt.getTime() > Date.now(), 'the new expiry was persisted')
  assert.equal(connection.status, 'ACTIVE')
})

test('every operation leaves a record behind', async () => {
  const { prisma } = await import('@/lib/db')
  const logs = await prisma.channelSyncLog.findMany({ where: { connectionId } })

  assert.ok(logs.some(log => log.kind === 'IMPORT' && log.outcome === 'SUCCESS'))
  assert.ok(logs.some(log => log.kind === 'AVAILABILITY' && log.outcome === 'SUCCESS'))
})

test('a disabled connection refuses to sync', async () => {
  const { prisma } = await import('@/lib/db')
  await prisma.channelConnection.update({ where: { id: connectionId }, data: { syncEnabled: false } })

  await assert.rejects(
    () => sync.syncAvailabilityWindow(connectionId),
    /switched off/i,
    'the per-connection kill switch must actually stop work',
  )

  await prisma.channelConnection.update({ where: { id: connectionId }, data: { syncEnabled: true } })
})
