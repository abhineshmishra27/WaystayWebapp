require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL.replace(/(^\"|\"$)/g, '') }),
})

async function main() {
  try {
    const owner = await prisma.user.findUnique({ where: { email: 'owner@demo.com' } })
    if (!owner) {
      console.log('Owner user not found; run ensure-demo-users.js first')
      return
    }

    const existing = await prisma.hotel.findFirst({ where: { ownerId: owner.id } })
    if (existing) {
      console.log('Demo hotel already exists:', existing.id)
      return
    }

    const hotel = await prisma.hotel.create({
      data: {
        ownerId: owner.id,
        name: 'Demo Inn',
        description: 'A demo hotel for WayStayy used for testing and development purposes. Spacious rooms and great service.',
        address: '123 Demo Street',
        city: 'DemoCity',
        state: 'DemoState',
        country: 'India',
        pincode: '123456',
        lat: 12.9716,
        lng: 77.5946,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        amenities: ['wifi','ac','breakfast'],
        isApproved: true,
        isActive: true,
        rating_avg: 0,
        total_review: 0,
        license_number: '',
        gst_number: '',
      },
    })

    console.log('Created demo hotel:', hotel.id)
  } catch (e) {
    console.error(e)
  } finally {
    await prisma.$disconnect()
  }
}

main()
