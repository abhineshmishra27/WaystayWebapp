import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { seedFixtures, setupTestDatabase, teardownTestDatabase, type TestFixtures } from '../support/route-harness.mts'
import { createCloudbedsFake, FAKE_PROPERTY_ID } from '../support/cloudbeds-fake.mjs'
import { control, resetCloudinaryStub, uploads } from '../support/cloudinary-stub.mts'

/**
 * Re-hosting channel photographs.
 *
 * Imported listings previously showed a placeholder, because next/image only accepts
 * allowlisted hosts and a channel's own CDN is not one of them. Rather than allowlist
 * each provider - which hotlinks their CDN, so their URL changes blank our listings -
 * images are copied into our own Cloudinary account at import.
 *
 * The cases worth defending are the failure ones: ingestion must never cost us the
 * import, and re-importing must not stack duplicates on a listing.
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
  // The real values are irrelevant - the client is stubbed - but ingestion refuses to
  // run when it believes Cloudinary is unconfigured, which is its own test below.
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  process.env.CLOUDINARY_API_KEY = 'test-key'
  process.env.CLOUDINARY_API_SECRET = 'test-secret'

  const { prisma } = await import('@/lib/db')
  const { encryptSecret } = await import('@/lib/crypto')
  sync = await import('@/lib/channels/sync')

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
})

after(async () => {
  await fake?.close()
  await teardownTestDatabase()
})

beforeEach(() => {
  resetCloudinaryStub()
})

test('property and room photographs are re-hosted on import', async () => {
  const result = await sync.importHotelFromConnection(connectionId)
  const { prisma } = await import('@/lib/db')

  // The fake exposes one property photo and one photo on the standard room type.
  assert.ok(uploads.length >= 2, `expected uploads, got ${uploads.length}`)
  assert.ok(uploads.every(upload => upload.source.startsWith('http')), 'the provider URL is what gets fetched')

  const images = await prisma.hotelImage.findMany({ where: { hotelId: result.hotelId } })
  assert.equal(images.length, 1)
  assert.match(images[0].url, /res\.cloudinary\.com/)
  assert.ok(images[0].publicId, 'the public id is stored so a re-import can replace in place')

  const rooms = await prisma.room.findMany({ where: { hotelId: result.hotelId } })
  const withPhoto = rooms.find(room => room.images.length > 0)
  assert.ok(withPhoto, 'the room that has a photo keeps it')
  assert.match(withPhoto.images[0], /res\.cloudinary\.com/)
})

test('re-importing replaces images rather than accumulating them', async () => {
  const { prisma } = await import('@/lib/db')
  const before = await prisma.hotelImage.count()

  await sync.importHotelFromConnection(connectionId)
  await sync.importHotelFromConnection(connectionId)

  const after = await prisma.hotelImage.count()
  assert.equal(after, before, 'a property synced nightly must not grow an unbounded gallery')
})

test('the public id is stable across imports, so uploads overwrite in place', async () => {
  await sync.importHotelFromConnection(connectionId)
  const firstIds = uploads.map(upload => upload.publicId).sort()

  resetCloudinaryStub()
  await sync.importHotelFromConnection(connectionId)
  const secondIds = uploads.map(upload => upload.publicId).sort()

  assert.deepEqual(secondIds, firstIds)
  // And they are namespaced to the connection, so two properties cannot collide.
  assert.ok(firstIds.every(id => id.includes(FAKE_PROPERTY_ID)))
})

test('an image that will not upload does not cost us the import', async () => {
  control.failAllUploads = true
  const { prisma } = await import('@/lib/db')

  // A listing with no photograph is worse than one with photographs, and far better
  // than no listing at all.
  const result = await sync.importHotelFromConnection(connectionId)
  assert.ok(result.hotelId)
  assert.equal(result.roomsUpserted, 2)

  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: result.hotelId } })
  assert.equal(hotel.name, 'Fake Harbour Hotel')

  control.failAllUploads = false
})

test('one bad photograph does not lose the others', async () => {
  control.failNextUpload = true
  await sync.importHotelFromConnection(connectionId)
  // The fake offers two images across property and rooms; the first attempt throws and
  // the rest must still be taken.
  assert.ok(uploads.length >= 1, 'remaining images are still ingested after one failure')
})

test('with Cloudinary unconfigured the import still succeeds, just without photographs', async () => {
  const saved = process.env.CLOUDINARY_CLOUD_NAME
  delete process.env.CLOUDINARY_CLOUD_NAME

  const { prisma } = await import('@/lib/db')
  await prisma.hotelImage.deleteMany({})

  const result = await sync.importHotelFromConnection(connectionId)
  assert.ok(result.hotelId)
  assert.equal(uploads.length, 0, 'nothing is attempted when the credentials are absent')
  assert.equal(await prisma.hotelImage.count({ where: { hotelId: result.hotelId } }), 0)

  process.env.CLOUDINARY_CLOUD_NAME = saved
})

test('a non-http image reference is refused rather than handed to Cloudinary', async () => {
  const { ingestImages } = await import('@/lib/channels/images')
  const result = await ingestImages(
    ['file:///etc/passwd', 'not a url', 'ftp://example.test/x.jpg', ''],
    'guard-test',
  )
  assert.deepEqual(result, [])
  assert.equal(uploads.length, 0, 'we must not ask Cloudinary to fetch arbitrary schemes')
})

test('an absurd gallery is capped rather than imported wholesale', async () => {
  const { ingestImages } = await import('@/lib/channels/images')
  const many = Array.from({ length: 50 }, (_, index) => `https://fake.test/${index}.jpg`)
  const result = await ingestImages(many, 'cap-test')
  assert.equal(result.length, 8)
  assert.equal(uploads.length, 8)
})
