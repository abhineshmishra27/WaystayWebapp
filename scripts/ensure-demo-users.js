require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '').replace(/(^\"|\"$)/g, ''),
  }),
})

async function upsertUser(email, name, password, role) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log('Exists:', email)
    return existing
  }
  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, name, passwordHash, role, isActive: true }, select: { id: true, email: true, name: true, role: true } })
  console.log('Created:', email)
  return user
}

async function main() {
  try {
    await upsertUser('admin@waystayy.com', 'Admin', 'Admin@123', 'ADMIN')
    await upsertUser('owner@demo.com', 'Owner Demo', 'Owner@123', 'OWNER')
    await upsertUser('customer@demo.com', 'Customer Demo', 'Cust@123', 'CUSTOMER')
  } catch (e) {
    console.error(e)
  } finally {
    await prisma.$disconnect()
  }
}

main()
