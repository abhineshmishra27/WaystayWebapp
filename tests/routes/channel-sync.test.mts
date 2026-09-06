import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  seedFixtures,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from '../support/route-harness.mts'

/**
 * Overcommitment detection, against a real database.
 *
 * This is the detection half of "never double-sell". Prevention cannot be absolute -
 * there is always a gap between an OTA selling a room and us hearing about it - so what
 * matters is that once the gap has been exploited, the next sync says so out loud.
 *
 * It needs real rows to be worth anything: the arithmetic spans bookings, their covered
 * nights, channel holds and room inventory, and a mock of any of those would be testing
 * the mock.
 */

let fixtures: TestFixtures
let detectOvercommitment: typeof import('@/lib/channels/sync').detectOvercommitment

before(async () => {
  await setupTestDatabase()
  fixtures = await seedFixtures()
  const sync = await import('@/lib/channels/sync')
  detectOvercommitment = sync.detectOvercommitment
})

after(async () => {
  await teardownTestDatabase()
})

async function reset() {
  const { prisma } = await import('@/lib/db')
  await prisma.channelInventoryHold.deleteMany({})
  await prisma.booking.deleteMany({})
}

async function bookChannelRoom(nights = 1) {
  const { prisma } = await import('@/lib/db')
  const slot = await prisma.roomSlot.findFirstOrThrow({
    where: { roomId: fixtures.channelRoomId, date: fixtures.stayDate },
  })
  return prisma.booking.create({
    data: {
      customerId: fixtures.customerId,
      roomSlotId: slot.id,
      checkIn: new Date(`${fixtures.stayDate}T12:00:00Z`),
      checkOut: new Date(`${fixtures.nextDate}T11:00:00Z`),
      totalHours: 24 * nights,
      totalAmount: 2000,
      guestName: 'Drift Test',
      guestEmail: 'drift@waystay.test',
      guestPhone: '9999999999',
      guestCount: 1,
      roomCount: 1,
      status: 'CONFIRMED',
    },
  })
}

test('a quiet room reports nothing', async () => {
  await reset()
  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate, fixtures.nextDate])
  assert.deepEqual(found, [])
})

test('a booking alone, within inventory, is not overcommitment', async () => {
  await reset()
  await bookChannelRoom()
  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate])
  assert.deepEqual(found, [], 'one booking against one unit is exactly capacity, not over it')
})

test('a hold alone, within inventory, is not overcommitment', async () => {
  await reset()
  const { prisma } = await import('@/lib/db')
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.channelRoomId, date: fixtures.stayDate, unitsHeld: 1 },
  })
  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate])
  assert.deepEqual(found, [])
})

test('a booking and a channel hold on the same night is the double sale', async () => {
  // Exactly the scenario the whole design exists to catch: we sold the room, and the
  // channel sold it too before telling us.
  await reset()
  await bookChannelRoom()
  const { prisma } = await import('@/lib/db')
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.channelRoomId, date: fixtures.stayDate, unitsHeld: 1 },
  })

  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate, fixtures.nextDate])
  assert.equal(found.length, 1)
  assert.equal(found[0].date, fixtures.stayDate)
  assert.equal(found[0].roomId, fixtures.channelRoomId)
  assert.equal(found[0].bookedUnits, 1)
  assert.equal(found[0].heldUnits, 1)
  assert.equal(found[0].inventoryCount, 1)
})

test('a multi-night booking is counted on every night it occupies', async () => {
  // The subtle one: a booking is stored against its first night only, so counting by
  // roomSlot.date alone would miss the conflict on the second night entirely.
  await reset()
  await bookChannelRoom(2)
  const { prisma } = await import('@/lib/db')
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.channelRoomId, date: fixtures.nextDate, unitsHeld: 1 },
  })

  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate, fixtures.nextDate])
  assert.equal(found.length, 1, 'the second night of the stay must be seen as occupied')
  assert.equal(found[0].date, fixtures.nextDate)
})

test('dates outside the window asked about are not reported', async () => {
  await reset()
  await bookChannelRoom()
  const { prisma } = await import('@/lib/db')
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.channelRoomId, date: fixtures.stayDate, unitsHeld: 1 },
  })
  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.nextDate])
  assert.deepEqual(found, [])
})

test('rooms belonging to another connection are not reported', async () => {
  await reset()
  const { prisma } = await import('@/lib/db')
  // The ordinary hotel's room is not mapped to this connection, so even a clear
  // overcommitment there is somebody else's problem.
  await prisma.channelInventoryHold.create({
    data: { roomId: fixtures.roomId, date: fixtures.stayDate, unitsHeld: 5 },
  })
  const found = await detectOvercommitment(fixtures.connectionId, [fixtures.stayDate])
  assert.deepEqual(found, [])
})
