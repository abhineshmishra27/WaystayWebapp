require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL.replace(/(^"|"$)/g, '') }),
})

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: 'owner@demo.com' } })
  if (!owner) {
    console.log('Owner user not found. Run ensure-demo-users.js first.')
    return
  }

  const hotel = await prisma.hotel.findFirst({ where: { ownerId: owner.id } })
  if (!hotel) {
    console.log('Demo hotel not found. Run ensure-demo-hotel.js first.')
    return
  }

  let room = await prisma.room.findFirst({ where: { hotelId: hotel.id, name: 'Demo Suite' } })
  if (!room) {
    room = await prisma.room.create({
      data: {
        hotelId: hotel.id,
        name: 'Demo Suite',
        type: 'SUITE',
        description: 'A comfortable suite that showcases the WayStayy room booking flow.',
        available: true,
        pricePerHour: 1000,
        price_3h: 3000,
        price_6h: 5500,
        price_9h: 8000,
        price_12h: 10000,
        priceFullDay: 12000,
        maxOccupancy: 4,
        amenities: ['wifi', 'ac', 'breakfast', 'tv'],
        images: [],
        base_clean_video_id: '',
        last_clean_video_id: '',
        floor_number: 2,
        area_sqft: 450,
        ai_clean_score: 100,
        ai_last_checked_at: new Date(),
        ai_clean_status: 'clean',
      },
    })
    console.log('Created demo room:', room.id)
  } else {
    console.log('Demo room already exists:', room.id)
  }

  const dates = [formatDate(new Date(Date.now() + 86400000)), formatDate(new Date(Date.now() + 2 * 86400000))]
  const slots = []

  for (const date of dates) {
    slots.push(
      { roomId: room.id, date, slotType: 'H3', startTime: '08:00', endTime: '11:00' },
      { roomId: room.id, date, slotType: 'H6', startTime: '08:00', endTime: '14:00' },
      { roomId: room.id, date, slotType: 'H9', startTime: '08:00', endTime: '17:00' },
      { roomId: room.id, date, slotType: 'H12', startTime: '08:00', endTime: '20:00' },
      { roomId: room.id, date, slotType: 'FULLDAY', startTime: '08:00', endTime: '20:00' },
    )
  }

  const result = await prisma.roomSlot.createMany({ data: slots, skipDuplicates: true })
  console.log('Ensured demo slots count:', result.count)
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
