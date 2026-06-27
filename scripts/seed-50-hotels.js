require('dotenv').config()

const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: (process.env.DATABASE_URL || '').replace(/(^"|"$)/g, ''),
  }),
})

const cities = [
  { city: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { city: 'Goa', state: 'Goa', lat: 15.2993, lng: 74.124 },
  { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { city: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
]

const hotelTypes = [
  { suffix: 'Grand Residency', price: 1299, image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200' },
  { suffix: 'Urban Nest', price: 1499, image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200' },
  { suffix: 'Comfort Suites', price: 1699, image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200' },
  { suffix: 'Business Inn', price: 1899, image: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1200' },
  { suffix: 'Premium Stay', price: 2199, image: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200' },
]

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

async function ensureSlots(roomId, days = 45) {
  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)

  const slots = []
  for (let offset = 0; offset < days; offset += 1) {
    const date = formatDate(addDays(startDate, offset))
    slots.push(
      { roomId, date, slotType: 'H3', startTime: '06:00', endTime: '09:00' },
      { roomId, date, slotType: 'H3', startTime: '09:00', endTime: '12:00' },
      { roomId, date, slotType: 'H3', startTime: '15:00', endTime: '18:00' },
      { roomId, date, slotType: 'H6', startTime: '06:00', endTime: '12:00' },
      { roomId, date, slotType: 'H6', startTime: '12:00', endTime: '18:00' },
      { roomId, date, slotType: 'H12', startTime: '06:00', endTime: '18:00' },
      { roomId, date, slotType: 'FULLDAY', startTime: '12:00', endTime: '11:00' },
    )
  }

  await prisma.roomSlot.createMany({ data: slots, skipDuplicates: true })
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  const passwordHash = await bcrypt.hash('Owner@123', 12)
  let seededHotels = 0

  for (const [cityIndex, cityInfo] of cities.entries()) {
    const citySlug = slug(cityInfo.city)
    const owner = await prisma.user.upsert({
      where: { email: `owner.${citySlug}@waystayy.com` },
      update: { name: `${cityInfo.city} Owner`, role: 'OWNER', isActive: true },
      create: {
        email: `owner.${citySlug}@waystayy.com`,
        passwordHash,
        name: `${cityInfo.city} Owner`,
        phone: `98888${String(cityIndex).padStart(5, '0')}`,
        role: 'OWNER',
        isActive: true,
      },
    })

    for (const [hotelIndex, hotelType] of hotelTypes.entries()) {
      const id = `seed-${citySlug}-${hotelIndex + 1}`
      const name = `WayStayy ${cityInfo.city} ${hotelType.suffix}`
      const basePrice = hotelType.price + cityIndex * 75

      const hotel = await prisma.hotel.upsert({
        where: { id },
        update: {
          ownerId: owner.id,
          name,
          city: cityInfo.city,
          state: cityInfo.state,
          isApproved: true,
          isActive: true,
        },
        create: {
          id,
          ownerId: owner.id,
          name,
          description: `${name} is a clean and comfortable WayStayy hotel for hourly and full-day stays with reliable service, AC rooms, WiFi, restaurant access, and easy check-in.`,
          address: `${100 + hotelIndex}, Central ${cityInfo.city}`,
          city: cityInfo.city,
          state: cityInfo.state,
          country: 'India',
          pincode: `${220000 + cityIndex * 100 + hotelIndex}`,
          lat: cityInfo.lat + hotelIndex * 0.01,
          lng: cityInfo.lng + hotelIndex * 0.01,
          highway_tag: hotelIndex % 2 === 0,
          checkInTime: '12:00',
          checkOutTime: '11:00',
          amenities: ['WiFi', 'AC', 'TV', 'Parking', 'Restaurant', 'Room Service'],
          isApproved: true,
          isActive: true,
          checkin_policy: 'Check-in time is 12 PM. Valid government ID is required.',
          checkout_policy: 'Check-out time is 11 AM for full-day stays.',
          rating_avg: 4.1 + hotelIndex * 0.1,
          total_review: 18 + cityIndex + hotelIndex * 3,
          license_number: `WL-${citySlug.toUpperCase()}-${hotelIndex + 101}`,
          gst_number: `29WAYSTAYY${cityIndex}${hotelIndex}Z5`,
        },
      })

      const imageCount = await prisma.hotelImage.count({ where: { hotelId: hotel.id } })
      if (imageCount === 0) {
        await prisma.hotelImage.createMany({
          data: [
            { hotelId: hotel.id, url: hotelType.image, sortOrder: 0, caption: `${cityInfo.city} hotel exterior` },
            { hotelId: hotel.id, url: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200', sortOrder: 1, caption: 'Guest room' },
          ],
        })
      }

      const roomId = `seed-room-${citySlug}-${hotelIndex + 1}`
      const room = await prisma.room.upsert({
        where: { id: roomId },
        update: {
          hotelId: hotel.id,
          isActive: true,
          available: true,
          price_3h: basePrice,
          price_6h: basePrice + 900,
          price_9h: basePrice + 1500,
          price_12h: basePrice + 2100,
          priceFullDay: basePrice + 2600,
        },
        create: {
          id: roomId,
          hotelId: hotel.id,
          name: 'Deluxe Room',
          type: 'DELUXE',
          description: 'Deluxe AC room with WiFi, smart TV, clean linen, hot water, and room service.',
          available: true,
          pricePerHour: Math.round(basePrice / 3),
          price_3h: basePrice,
          price_6h: basePrice + 900,
          price_9h: basePrice + 1500,
          price_12h: basePrice + 2100,
          priceFullDay: basePrice + 2600,
          maxOccupancy: 3,
          amenities: ['AC', 'TV', 'WiFi', 'Hot Water', 'Room Service'],
          images: ['https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200'],
          isActive: true,
          base_clean_video_id: 'seed-clean-video',
          last_clean_video_id: 'seed-clean-video',
          floor_number: hotelIndex + 1,
          area_sqft: 280 + hotelIndex * 20,
          ai_clean_score: 9.2,
          ai_last_checked_at: new Date(),
          ai_clean_status: 'clean',
        },
      })

      await ensureSlots(room.id)

      const existingRestaurant = await prisma.restaurant.findUnique({ where: { hotelId: hotel.id } })
      if (!existingRestaurant) {
        await prisma.restaurant.create({
          data: {
            hotelId: hotel.id,
            name: `${cityInfo.city} Table`,
            description: `Multi-cuisine restaurant at ${name}.`,
            isActive: true,
            menuItems: {
              create: [
                { category: 'Breakfast', name: 'Masala Dosa', price: 180, isVeg: true, isAvailable: true },
                { category: 'Main Course', name: 'Paneer Butter Masala', price: 320, isVeg: true, isAvailable: true },
                { category: 'Main Course', name: 'Chicken Biryani', price: 380, isVeg: false, isAvailable: true },
              ],
            },
          },
        })
      }

      seededHotels += 1
    }
  }

  console.log(`Seeded or updated ${seededHotels} hotels.`)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
