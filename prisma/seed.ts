import 'dotenv/config'
import { PrismaClient, Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.WAYSTAY_DATABASE_URL_UNPOOLED ??
      process.env.WAYSTAY_DATABASE_URL ??
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      '',
  }),
})

async function main() {
  console.log('Seeding database...')

  const adminHash = await bcrypt.hash('Admin@123', 12)
  const ownerHash = await bcrypt.hash('Owner@123', 12)
  const custHash = await bcrypt.hash('Cust@123', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@waystayy.com' },
    update: {},
    create: {
      email: 'admin@waystayy.com',
      passwordHash: adminHash,
      name: 'Super Admin',
      phone: '9999900000',
      role: Role.ADMIN,
    },
  })

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {},
    create: {
      email: 'owner@demo.com',
      passwordHash: ownerHash,
      name: 'Demo Hotel Owner',
      phone: '9888800000',
      role: Role.OWNER,
    },
  })

  const customer = await prisma.user.upsert({
    where: { email: 'customer@demo.com' },
    update: {},
    create: {
      email: 'customer@demo.com',
      passwordHash: custHash,
      name: 'Test Customer',
      phone: '9777700000',
      role: Role.CUSTOMER,
    },
  })

  const hotel = await prisma.hotel.upsert({
    where: { id: 'demo-hotel-001' },
    update: {},
    create: {
      id: 'demo-hotel-001',
      ownerId: owner.id,
      name: 'The Grand Bangalore',
      description: 'A premium hotel in the heart of Bangalore with modern amenities and excellent service.',
      address: '123 MG Road',
      city: 'Bangalore',
      state: 'Karnataka',
      country: 'India',
      pincode: '243003',
      lat: 12.9716,
      lng: 77.5946,
      highway_tag: true,
      checkInTime: '12:00',
      checkOutTime: '11:00',
      checkin_policy: 'Check-in time is 12 PM',
      checkout_policy: 'Check-out time is 11 AM',
      license_number: 'LG7676762',
      gst_number: '2323232332',
      rating_avg: 4.1,
      total_review: 11,
      amenities: ['WiFi', 'Parking', 'AC', 'TV', 'Restaurant', 'Laundry'],
      isApproved: true,
      images: {
        create: [
          { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800', sortOrder: 0, caption: 'Hotel exterior' },
          { url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800', sortOrder: 1, caption: 'Deluxe room' },
        ],
      },
    },
  })

  const room1 = await prisma.room.upsert({
    where: { id: 'demo-room-001' },
    update: {},
    create: {
      id: 'demo-room-001',
      hotelId: hotel.id,
      name: 'Standard Room 101',
      type: 'STANDARD',
      description: 'Comfortable standard room with city view',
      pricePerHour: 299,
      price_3h: 299,
      price_6h: 399,
      price_9h: 499,
      price_12h: 999,
      priceFullDay: 1999,
      maxOccupancy: 3,
      amenities: ['AC', 'TV', 'WiFi', 'Hot Water'],
      images: ['https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800'],
      base_clean_video_id: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800',
      last_clean_video_id: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800',
      floor_number: 1,
      area_sqft: 250,
      ai_clean_score: 8.5,
      ai_last_checked_at: new Date(),
      ai_clean_status: 'clean',
    },
  })

  const room2 = await prisma.room.upsert({
    where: { id: 'demo-room-002' },
    update: {},
    create: {
      id: 'demo-room-002',
      hotelId: hotel.id,
      name: 'Deluxe Suite 201',
      type: 'DELUXE',
      description: 'Spacious deluxe suite with premium amenities',
      pricePerHour: 599,
      price_3h: 599,
      price_6h: 699,
      price_9h: 999,
      price_12h: 2999,
      priceFullDay: 3999,
      maxOccupancy: 3,
      amenities: ['AC', 'TV', 'WiFi', 'Mini Bar', 'Balcony', 'Hot Water'],
      isActive: true,
      base_clean_video_id: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800',
      last_clean_video_id: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800',
      floor_number: 2,
      area_sqft: 110,
      ai_clean_score: 9,
      ai_last_checked_at: new Date(),
      ai_clean_status: 'clean',
      images: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800'],
    },
  })

  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  for (const date of [today, tomorrow]) {
    await prisma.roomSlot.createMany({
      skipDuplicates: true,
      data: [
        { roomId: room1.id, date, slotType: 'H3', startTime: '06:00', endTime: '09:00' },
        { roomId: room1.id, date, slotType: 'H3', startTime: '09:00', endTime: '12:00' },
        { roomId: room1.id, date, slotType: 'H3', startTime: '15:00', endTime: '18:00' },
        { roomId: room1.id, date, slotType: 'H3', startTime: '18:00', endTime: '21:00' },
        { roomId: room1.id, date, slotType: 'H6', startTime: '06:00', endTime: '12:00' },
        { roomId: room1.id, date, slotType: 'H6', startTime: '12:00', endTime: '18:00' },
        { roomId: room1.id, date, slotType: 'H12', startTime: '06:00', endTime: '18:00' },
        { roomId: room1.id, date, slotType: 'FULLDAY', startTime: '12:00', endTime: '11:00' },
        { roomId: room2.id, date, slotType: 'H3', startTime: '06:00', endTime: '09:00' },
        { roomId: room2.id, date, slotType: 'H3', startTime: '09:00', endTime: '12:00' },
        { roomId: room2.id, date, slotType: 'H6', startTime: '06:00', endTime: '12:00' },
        { roomId: room2.id, date, slotType: 'H6', startTime: '12:00', endTime: '18:00' },
        { roomId: room2.id, date, slotType: 'H12', startTime: '06:00', endTime: '18:00' },
        { roomId: room2.id, date, slotType: 'FULLDAY', startTime: '12:00', endTime: '11:00' },
      ],
    })
  }

  console.log('Seed complete.')
  console.log('Admin:', admin.email, '/ Admin@123')
  console.log('Owner:', owner.email, '/ Owner@123')
  console.log('Customer:', customer.email, '/ Cust@123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
