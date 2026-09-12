import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seedFixtures, setupTestDatabase, teardownTestDatabase, type TestFixtures } from '../support/route-harness.mts'
import { createCloudbedsFake, FAKE_PROPERTY_ID } from '../support/cloudbeds-fake.mjs'

/**
 * Does an imported property actually become visible to a guest?
 *
 * Every other test checks a step. This one checks the outcome the whole integration
 * exists for: connect, import, sync, approve, and the hotel is findable and bookable in
 * search. It is also the test that pins the deliberate gate - imported inventory is not
 * published automatically, and if that ever changes silently, this fails.
 */

let fixtures: TestFixtures
let fake: ReturnType<typeof createCloudbedsFake>
let connectionId: string
let importedHotelId: string
let sync: typeof import('@/lib/channels/sync')
let searchGET: typeof import('@/app/api/search/route').GET

async function search(query: string) {
  const { NextRequest } = await import('next/server')
  const response = await searchGET(new NextRequest(`http://localhost/api/search?${query}`))
  return response.json() as Promise<{ count: number; hotels: Array<{ id: string; name: string; priceFullDay: number | null; price3h: number | null; image: string | null }> }>
}

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
  searchGET = (await import('@/app/api/search/route')).GET

  // A fresh connection for the fake property, alongside the seeded fixtures.
  const connection = await prisma.channelConnection.create({
    data: {
      provider: 'CLOUDBEDS',
      externalPropertyId: FAKE_PROPERTY_ID,
      ownerId: fixtures.ownerId,
      status: 'ACTIVE',
      accessTokenEnc: encryptSecret('a'),
      refreshTokenEnc: encryptSecret('b'),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      scopes: [],
    },
  })
  connectionId = connection.id

  const imported = await sync.importHotelFromConnection(connectionId)
  importedHotelId = imported.hotelId
  await sync.syncAvailabilityWindow(connectionId, { days: 10 })
})

after(async () => {
  await fake?.close()
  await teardownTestDatabase()
})

function stayDates() {
  const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  return { start, end }
}

test('a freshly imported hotel is NOT visible to guests', async () => {
  // The gate, stated as a test: third-party inventory does not publish itself. If this
  // ever starts passing hotels through, someone has removed a deliberate safeguard.
  const { start, end } = stayDates()
  const results = await search(`city=Bengaluru&slot=FULLDAY&startDate=${start}&endDate=${end}`)
  assert.ok(
    !results.hotels.some(hotel => hotel.id === importedHotelId),
    'an unapproved import must not reach search',
  )
})

test('approving it makes it appear, priced and bookable', async () => {
  const { prisma } = await import('@/lib/db')
  await prisma.hotel.update({ where: { id: importedHotelId }, data: { isApproved: true } })

  const { start, end } = stayDates()
  const results = await search(`city=Bengaluru&slot=FULLDAY&startDate=${start}&endDate=${end}`)

  const found = results.hotels.find(hotel => hotel.id === importedHotelId)
  assert.ok(found, `imported hotel should be findable; got ${results.hotels.map(h => h.name).join(', ')}`)
  assert.equal(found.name, 'Fake Harbour Hotel')
  // Priced from the rate plan, for the two nights requested.
  assert.ok(found.priceFullDay && found.priceFullDay > 0, 'a night price must be shown')
})

test('it is offered for nights only, never by the hour', async () => {
  const { start } = stayDates()

  const hourly = await search(`city=Bengaluru&slot=H3&startDate=${start}&endDate=${start}`)
  assert.ok(
    !hourly.hotels.some(hotel => hotel.id === importedHotelId),
    'a channel property has no hourly inventory and must not appear in an hourly search',
  )

  // And where it does appear, no transit fare is quoted for it.
  const browse = await search('city=Bengaluru')
  const found = browse.hotels.find(hotel => hotel.id === importedHotelId)
  assert.ok(found)
  assert.equal(found.price3h, null, 'no hourly price for a night-only property')
})

test('a night the channel has sold is not offered by WayStay', async () => {
  const { prisma } = await import('@/lib/db')
  const { start, end } = stayDates()

  const mapping = await prisma.channelRoomMapping.findFirstOrThrow({
    where: { connectionId, externalRoomTypeId: 'rt-standard' },
  })
  const deluxe = await prisma.channelRoomMapping.findFirstOrThrow({
    where: { connectionId, externalRoomTypeId: 'rt-deluxe' },
  })

  // Withhold every unit of both rooms for the requested night.
  for (const roomId of [mapping.roomId, deluxe.roomId]) {
    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } })
    await prisma.channelInventoryHold.upsert({
      where: { roomId_date: { roomId, date: start } },
      create: { roomId, date: start, unitsHeld: room.inventoryCount },
      update: { unitsHeld: room.inventoryCount },
    })
  }

  const results = await search(`city=Bengaluru&slot=FULLDAY&startDate=${start}&endDate=${end}`)
  assert.ok(
    !results.hotels.some(hotel => hotel.id === importedHotelId),
    'a fully held property must drop out of search for that night',
  )

  // Released on the channel, offered again by us.
  await prisma.channelInventoryHold.deleteMany({ where: { date: start } })
  const after = await search(`city=Bengaluru&slot=FULLDAY&startDate=${start}&endDate=${end}`)
  assert.ok(after.hotels.some(hotel => hotel.id === importedHotelId), 'and returns when the hold clears')
})

test('the listing shows a photograph, served from our own image host', async () => {
  const browse = await search('city=Bengaluru')
  const found = browse.hotels.find(hotel => hotel.id === importedHotelId)
  assert.ok(found)
  assert.ok(found.image, 'an imported listing must not fall back to a placeholder')
  // Must be re-hosted, not the provider's URL: next.config.ts allowlists Cloudinary, so
  // a channel-hosted photo would be rejected by next/image and render as nothing.
  assert.match(found.image, /res\.cloudinary\.com/)
})
