import { execFileSync } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import { createTestBranch, deleteTestBranch } from './neon-branch.mjs'

// Unit tests need no environment, so nothing in the test setup loaded one. Route tests
// do: the Neon project id and API key live here. Same precedence as prisma.config.ts,
// and it must happen at module load, before setupTestDatabase overwrites the database
// URLs with the branch it creates.
loadEnv({ path: '.env.local' })
loadEnv()

/**
 * Boots a disposable database for route tests and tears it down again.
 *
 * Order matters and is easy to get wrong: src/lib/db.ts reads its connection string at
 * module load, so the branch URL has to be in the environment *before* anything that
 * imports Prisma is imported. Every module here is therefore loaded dynamically, after
 * setup - a static import at the top of a test file would connect to the dev database
 * instead, and quietly pass while writing to real data.
 */

export type TestFixtures = {
  customerId: string
  ownerId: string
  hotelId: string
  channelHotelId: string
  roomId: string
  channelRoomId: string
  connectionId: string
  slotId: string
  channelSlotId: string
  stayDate: string
  nextDate: string
}

let branch: Awaited<ReturnType<typeof createTestBranch>> | null = null

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export async function setupTestDatabase() {
  branch = await createTestBranch()

  // Every consumer of a connection string, so nothing falls through to the dev database.
  for (const name of [
    'WAYSTAY_DATABASE_URL',
    'WAYSTAY_DATABASE_URL_UNPOOLED',
    'DATABASE_URL',
    'DIRECT_URL',
  ]) {
    process.env[name] = branch.connectionUri
  }
  process.env.WAYSTAY_TEST_STUBS = '1'
  process.env.CHANNEL_CREDENTIALS_KEY ??= Buffer.alloc(32, 7).toString('base64')
  // Keeps the booking route on the pay-at-hotel path unless a test says otherwise;
  // exercising Razorpay would mean real API calls.
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID

  // The branch is a copy-on-write clone, so the schema is already there. Applying
  // migrations anyway makes the run correct even when the clone predates a migration.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env },
    shell: process.platform === 'win32',
  })

  return branch
}

export async function teardownTestDatabase() {
  if (!branch) return
  const { prisma } = await import('@/lib/db')
  await prisma.$disconnect().catch(() => {})
  await deleteTestBranch(branch)
  branch = null
}

/**
 * A minimal but realistic graph: one ordinary hotel and one channel-managed hotel, each
 * with a room and a full-day slot. The channel hotel exists so the pay-at-hotel refusal
 * and currency guard can be tested for real rather than by faking a flag.
 */
export async function seedFixtures(): Promise<TestFixtures> {
  const { prisma } = await import('@/lib/db')
  const { todayInIndia } = await import('@/lib/booking-time')

  // Clone inherits the dev data, so start from a clean slate for deterministic counts.
  await prisma.channelInventoryHold.deleteMany({})
  await prisma.channelBookingMapping.deleteMany({})
  await prisma.booking.deleteMany({})
  await prisma.roomSlot.deleteMany({})
  await prisma.channelRoomMapping.deleteMany({})
  await prisma.room.deleteMany({})
  await prisma.hotel.deleteMany({})
  await prisma.channelConnection.deleteMany({})

  const stayDate = addDays(todayInIndia(), 3)
  const nextDate = addDays(stayDate, 1)

  const customer = await prisma.user.upsert({
    where: { email: 'route-test-customer@waystay.test' },
    update: {},
    create: {
      email: 'route-test-customer@waystay.test',
      name: 'Route Test Customer',
      passwordHash: 'not-used',
      role: 'CUSTOMER',
    },
  })
  const owner = await prisma.user.upsert({
    where: { email: 'route-test-owner@waystay.test' },
    update: {},
    create: {
      email: 'route-test-owner@waystay.test',
      name: 'Route Test Owner',
      passwordHash: 'not-used',
      role: 'OWNER',
    },
  })

  const hotelBase = {
    ownerId: owner.id,
    description: 'A hotel used by route tests to exercise the booking guards.',
    address: '1 Test Street',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    lat: 12.9716,
    lng: 77.5946,
    amenities: [],
    isApproved: true,
    isActive: true,
    ownerEnabled: true,
    rating_avg: 0,
    total_review: 0,
  }

  const hotel = await prisma.hotel.create({ data: { ...hotelBase, name: 'Route Test Hotel' } })

  const connection = await prisma.channelConnection.create({
    data: {
      provider: 'CLOUDBEDS',
      externalPropertyId: 'route-test-property',
      ownerId: owner.id,
      status: 'ACTIVE',
      currency: 'INR',
      accessTokenEnc: 'v1.unused',
      refreshTokenEnc: 'v1.unused',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
      scopes: [],
    },
  })

  const channelHotel = await prisma.hotel.create({
    data: {
      ...hotelBase,
      name: 'Route Test Channel Hotel',
      channelConnectionId: connection.id,
      externalPropertyId: 'route-test-property',
    },
  })

  const roomBase = {
    description: 'Route test room',
    pricePerHour: 100,
    price_3h: 300,
    price_6h: 600,
    price_9h: 900,
    price_12h: 1200,
    priceFullDay: 2000,
    // inventoryCount 1 keeps capacity arithmetic obvious in assertions.
    inventoryCount: 1,
    maxOccupancy: 3,
    amenities: [],
    images: [],
  }

  const room = await prisma.room.create({ data: { ...roomBase, hotelId: hotel.id, name: 'Standard' } })
  const channelRoom = await prisma.room.create({
    data: {
      ...roomBase,
      hotelId: channelHotel.id,
      name: 'Channel Standard',
      // Imported rooms are night-only, matching what the mapper produces.
      threeHourEnabled: false,
      sixHourEnabled: false,
      twelveHourEnabled: false,
      nightStayEnabled: true,
    },
  })

  await prisma.channelRoomMapping.create({
    data: {
      connectionId: connection.id,
      externalRoomTypeId: 'route-test-room-type',
      roomId: channelRoom.id,
    },
  })

  // Two consecutive nights so multi-night behaviour can be exercised.
  const slotRows = [room.id, channelRoom.id].flatMap(roomId =>
    [stayDate, nextDate].map(date => ({
      roomId,
      date,
      slotType: 'FULLDAY' as const,
      startTime: '12:00',
      endTime: '11:00',
    })),
  )
  await prisma.roomSlot.createMany({ data: slotRows })

  const slot = await prisma.roomSlot.findFirstOrThrow({ where: { roomId: room.id, date: stayDate } })
  const channelSlot = await prisma.roomSlot.findFirstOrThrow({
    where: { roomId: channelRoom.id, date: stayDate },
  })

  return {
    customerId: customer.id,
    ownerId: owner.id,
    hotelId: hotel.id,
    channelHotelId: channelHotel.id,
    roomId: room.id,
    channelRoomId: channelRoom.id,
    connectionId: connection.id,
    slotId: slot.id,
    channelSlotId: channelSlot.id,
    stayDate,
    nextDate,
  }
}

/**
 * Builds the request a route handler expects. Handlers are typed against NextRequest,
 * not the platform Request, so tests construct the real thing rather than casting past
 * the difference.
 */
export async function jsonRequest(url: string, body: unknown, method = 'POST') {
  const { NextRequest } = await import('next/server')
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
