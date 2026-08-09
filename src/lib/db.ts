import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prefer the managed replacement database when it is attached. Runtime traffic
// should use the pooled URL; unpooled/direct URLs are reserved as fallbacks.
const connectionString = (
  process.env.WAYSTAY_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.WAYSTAY_DATABASE_URL_UNPOOLED ??
  process.env.DIRECT_URL ??
  ''
).replace(/(^\"|\"$)/g, '')

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
    }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
