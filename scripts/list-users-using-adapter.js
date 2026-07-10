require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '').replace(/(^\"|\"$)/g, ''),
    }),
  })
  try {
    const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true }, take: 50 })
    console.log(JSON.stringify(users, null, 2))
  } catch (e) {
    console.error('ERR', e)
  } finally {
    await prisma.$disconnect()
  }
}

main()
