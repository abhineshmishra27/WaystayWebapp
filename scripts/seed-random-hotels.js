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
  {
    city: 'Bangalore',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    hotel: 'WayStayy Urban Nest Bangalore',
    owner: 'Ananya Rao',
    image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200',
  },
  {
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    lat: 26.8467,
    lng: 80.9462,
    hotel: 'WayStayy Heritage Lucknow',
    owner: 'Raghav Verma',
    image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200',
  },
  {
    city: 'Delhi',
    state: 'Delhi',
    lat: 28.6139,
    lng: 77.209,
    hotel: 'WayStayy Capital Suites Delhi',
    owner: 'Meera Khanna',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200',
  },
  {
    city: 'Goa',
    state: 'Goa',
    lat: 15.2993,
    lng: 74.124,
    hotel: 'WayStayy Beachline Goa',
    owner: 'Nikhil D Souza',
    image: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200',
  },
  {
    city: 'Mumbai',
    state: 'Maharashtra',
    lat: 19.076,
    lng: 72.8777,
    hotel: 'WayStayy Metro Grand Mumbai',
    owner: 'Ishita Shah',
    image: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1200',
  },
]

const roomTemplates = [
  { name: 'Standard Room', type: 'STANDARD', hourly: 699, price3h: 1299, price6h: 2199, price9h: 2899, price12h: 3299, fullDay: 3499, area: 240 },
  { name: 'Deluxe Room', type: 'DELUXE', hourly: 999, price3h: 1899, price6h: 3199, price9h: 4299, price12h: 4699, fullDay: 4999, area: 320 },
  { name: 'Premium Suite', type: 'SUITE', hourly: 1399, price3h: 2499, price6h: 4499, price9h: 5899, price12h: 6499, fullDay: 6999, area: 460 },
  { name: 'Executive Suite', type: 'SUITE', hourly: 1699, price3h: 2999, price6h: 5299, price9h: 6999, price12h: 7899, fullDay: 8499, area: 540 },
]

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

async function ensureSlots(roomId, startDate, days) {
  const slots = []

  for (let offset = 0; offset < days; offset += 1) {
    const date = formatDate(addDays(startDate, offset))
    slots.push(
      { roomId, date, slotType: 'H3', startTime: '06:00', endTime: '09:00' },
      { roomId, date, slotType: 'H3', startTime: '09:00', endTime: '12:00' },
      { roomId, date, slotType: 'H3', startTime: '15:00', endTime: '18:00' },
      { roomId, date, slotType: 'H3', startTime: '18:00', endTime: '21:00' },
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
  const slotStart = new Date('2026-06-09T00:00:00')
  const slotDays = 180

  for (const [cityIndex, entry] of cities.entries()) {
    const owner = await prisma.user.upsert({
      where: { email: `owner.${entry.city.toLowerCase()}@waystayy.com` },
      update: { name: entry.owner, role: 'OWNER', isActive: true },
      create: {
        email: `owner.${entry.city.toLowerCase()}@waystayy.com`,
        passwordHash,
        name: entry.owner,
        phone: `98888000${cityIndex}${cityIndex}`,
        role: 'OWNER',
      },
    })

    const hotel = await prisma.hotel.upsert({
      where: { id: `seed-hotel-${entry.city.toLowerCase()}` },
      update: {
        ownerId: owner.id,
        isApproved: true,
        isActive: true,
        city: entry.city,
        state: entry.state,
      },
      create: {
        id: `seed-hotel-${entry.city.toLowerCase()}`,
        ownerId: owner.id,
        name: entry.hotel,
        description: `${entry.hotel} is a comfortable business and leisure hotel with hourly and full-day stays, clean rooms, restaurant access, and reliable service.`,
        address: `${100 + cityIndex}, Central ${entry.city}`,
        city: entry.city,
        state: entry.state,
        country: 'India',
        pincode: `${560000 + cityIndex}`,
        lat: entry.lat,
        lng: entry.lng,
        highway_tag: cityIndex % 2 === 0,
        checkInTime: '12:00',
        checkOutTime: '11:00',
        checkin_policy: 'Check-in time is 12 PM',
        checkout_policy: 'Check-out time is 11 AM',
        license_number: `WL-${entry.city.toUpperCase()}-${cityIndex + 100}`,
        gst_number: `29WAYSTAYY${cityIndex}Z5`,
        rating_avg: 4.1 + cityIndex * 0.1,
        total_review: 20 + cityIndex * 7,
        amenities: ['WiFi', 'Parking', 'AC', 'TV', 'Restaurant', 'Laundry'],
        isApproved: true,
        isActive: true,
        images: {
          create: [
            { url: entry.image, sortOrder: 0, caption: `${entry.city} hotel exterior` },
            { url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200', sortOrder: 1, caption: 'Guest room' },
          ],
        },
      },
    })

    for (const [roomIndex, template] of roomTemplates.entries()) {
      const room = await prisma.room.upsert({
        where: { id: `seed-room-${entry.city.toLowerCase()}-${roomIndex + 1}` },
        update: {
          hotelId: hotel.id,
          isActive: true,
          available: true,
          pricePerHour: template.hourly,
          price_3h: template.price3h,
          price_6h: template.price6h,
          price_9h: template.price9h,
          price_12h: template.price12h,
          priceFullDay: template.fullDay,
        },
        create: {
          id: `seed-room-${entry.city.toLowerCase()}-${roomIndex + 1}`,
          hotelId: hotel.id,
          name: `${template.name} ${roomIndex + 1}0${roomIndex + 1}`,
          type: template.type,
          description: `${template.name} with AC, WiFi, smart TV, clean linen, and attached bathroom.`,
          available: true,
          pricePerHour: template.hourly,
          price_3h: template.price3h,
          price_6h: template.price6h,
          price_9h: template.price9h,
          price_12h: template.price12h,
          priceFullDay: template.fullDay,
          maxOccupancy: 3,
          amenities: ['AC', 'TV', 'WiFi', 'Hot Water', 'Room Service'],
          images: ['https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200'],
          isActive: true,
          base_clean_video_id: 'seed-clean-video',
          last_clean_video_id: 'seed-clean-video',
          floor_number: roomIndex + 1,
          area_sqft: template.area,
          ai_clean_score: 9.1,
          ai_last_checked_at: new Date(),
          ai_clean_status: 'clean',
        },
      })

      await ensureSlots(room.id, slotStart, slotDays)
    }

    await prisma.restaurant.upsert({
      where: { hotelId: hotel.id },
      update: { isActive: true },
      create: {
        hotelId: hotel.id,
        name: `${entry.city} Table`,
        description: `Multi-cuisine restaurant at ${entry.hotel}.`,
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

    console.log(`Seeded ${entry.hotel} with 4 rooms and ${slotDays} days of slots.`)
  }

  console.log('Done. Owner password for seeded owners: Owner@123')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
